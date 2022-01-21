import Database from 'better-sqlite3'
// Using better-sqlite3 because prepared statements are confusing in node-sqlite3. Also its supposedly faster. Also the syntax is better.
import { randomBytes, scryptSync } from 'crypto'

export default class MushDB {
  constructor ({ path }) {
    // We care about the database, the root user id (might be able to be a group id?), name of the guest user
    this.db = new Database(path)
    this.db.pragma('journal_mode=WAL')
    this.db.pragma('foreign_keys=true')
    // https://www.sqlite.org/wal.html
    // https://github.com/JoshuaWise/better-sqlite3/blob/HEAD/docs/performance.md
    this.initializeFunctions()
    this.initializeTables()
    this.initializeStatements()
  }

  initializeFunctions () {
    this.db.function('scrypt', (password, salt) =>
      scryptSync(password, salt, 64).toString('hex')
    )
    this.db.function('in_array', (arr, val) =>
      JSON.parse(arr).includes(val) ? 1 : 0
    )
    this.db.function('add_to_array', (arr, val) =>
      JSON.stringify([...new Set([...JSON.parse(arr), val])])
    )
    this.db.function('remove_from_array', (arr, val) => {
      arr = JSON.parse(arr)
      const index = arr.indexOf(val)
      if (index !== -1) {
        arr.splice(index, 1)
      }
      return JSON.stringify(arr)
    })
  }

  initializeStatements () {
    const sql = this.sql()

    this._createThing = sql`INSERT INTO things (attributes) VALUES (json($attributes))`
    this._getThing = sql`SELECT * FROM things WHERE ref=$ref`
    this._patchThing = sql`UPDATE things SET attributes=json_patch((SELECT attributes FROM things WHERE ref=$ref),json($patch)) WHERE ref=$ref`
    this._destroyThing = sql`DELETE FROM things WHERE ref=$ref`

    this._createUser = sql`INSERT INTO users (name, password, salt, thingref) VALUES ($name, scrypt($password, $salt), $salt, $thingref)`
    this._setGroupOnUser = sql`UPDATE users SET groupref=$groupref WHERE thingref=$thingref`
    this._createGroup = sql`INSERT INTO groups (name, users, thingref) VALUES ($name, json($users), $thingref)`
    this._createPerms = sql`INSERT INTO permissions VALUES ($thingref, json($owners), json($readers), json($writers))`

    this._signIn = sql`SELECT groupref, name FROM users where name=$name and password=scrypt($password, (SELECT salt FROM users where name=$name))`
    this._checkPerms = sql`SELECT in_array(owners, $groupref) as isOwner, (in_array(readers, $groupref) OR in_array(readers, 'guest')) as isReader, in_array(writers, $groupref) as isWriter FROM permissions WHERE thingref=$thingref`

    this._addToGroup = sql`UPDATE groups SET users=add_to_array(users, $user) WHERE thingref=$thingref`
    this._removeFromGroup = sql`UPDATE groups SET users=remove_from_array(users, $user) WHERE thingref=$thingref`

    this._addPermission = permission =>
      sql`UPDATE permissions SET ${permission}=add_to_array(${permission}, $newUserRef) WHERE thingref=$thingref`
    this._removePermission = permission =>
      sql`UPDATE permissions SET ${permission}=remove_from_array(${permission}, $removedUserRef) WHERE thingref=$thingref`
  }

  initializeTables () {
    const sql = this.sql()

    sql`CREATE TABLE IF NOT EXISTS things (
      ref INTEGER PRIMARY KEY,
      attributes TEXT
    ) STRICT`.run()
    // things have an owner and attributes. Attributes are arbitrary like any object in a mush. User and Group attributes are stored as a thing.
    // Attributes is stuff that would be an &whatever on a MUSH

    sql`CREATE TABLE IF NOT EXISTS users (
      thingref INTEGER PRIMARY KEY REFERENCES things ON DELETE CASCADE,
      name TEXT UNIQUE, 
      password TEXT, 
      salt TEXT,
      groupref INTEGER REFERENCES groups
    ) STRICT`.run()
    // This is just here to be a storage for passwords and dbrefs

    sql`CREATE TABLE IF NOT EXISTS groups (
      thingref INTEGER PRIMARY KEY REFERENCES things ON DELETE CASCADE,
      name TEXT UNIQUE,
      users TEXT
    ) STRICT`.run()
    // Stores a Group's name and its users.
    // Every user has a Group of the same name for ease of ownership purposes?

    sql`CREATE TABLE IF NOT EXISTS permissions(
      thingref INTEGER PRIMARY KEY REFERENCES things ON DELETE CASCADE,
      owners TEXT,
      readers TEXT,
      writers TEXT
    ) STRICT`.run()
    // Lookup table that sees who can mess with a dbref and how
  }

  sql () {
    return (strings, ...expr) => {
      const statement = strings
        .map(
          (str, index) => str + (expr.length > index ? String(expr[index]) : '')
        )
        .join('')
      return this.db.prepare(statement)
    }
  }

  getPerms (thingref, { groupref }) {
    const perms = this._checkPerms.get({ thingref, groupref })
    if (!perms) {
      return {
        isReader: false,
        isWriter: false,
        isOwner: false
      }
    }
    if (perms.isOwner) {
      return {
        isReader: true,
        isWriter: true,
        isOwner: true
      }
    }
    return Object.fromEntries(
      Object.entries(perms).map(([key, value]) => [key, Boolean(value)])
    )
  }

  constructPerms (thingref, groupref, isPrivate = false) {
    return {
      thingref,
      owners: JSON.stringify([groupref]),
      readers: JSON.stringify(isPrivate ? [groupref] : ['guest', groupref]),
      writers: JSON.stringify([groupref])
    }
  }

  // User functions add  new users to the list of things, and flag a User as online or offile and return a User object to the Library's User
  createUser (name, password) {
    this.db.transaction(() => {
      const userthing = this._createThing.run({
        attributes: JSON.stringify({ name, type: 'user' })
      })
      const user = this._createUser.run({
        name,
        password,
        thingref: userthing.lastInsertRowid,
        salt: randomBytes(16).toString('hex')
      })
      const group = this.createGroup({ ref: user.lastInsertRowid }, name)
      this._setGroupOnUser.run({
        thingref: user.lastInsertRowid,
        groupref: group
      })
      this._createPerms.run(
        this.constructPerms(userthing.lastInsertRowid, group)
      )
    })()
    return this.signIn(name, password)
  }

  destroyUser (user) {
    this.db.transaction(() => {
      this.destroyThing(user.thingref, user)
      this.destroyGroup(user.groupref, user)
    })()
  }

  signIn (name, password) {
    return this._signIn.get({ name, password })
  }

  // These functions all run through a Role Access Service before allowing interaction with the Thing associated with the dbref
  getThing (thingref, user) {
    const { isReader } = this.getPerms(thingref, user)
    if (!isReader) return null
    const thing = this._getThing.get({ ref: thingref })
    return {
      ...thing,
      attributes: JSON.parse(thing.attributes)
    }
  }

  patchThing (thingref, user, patch) {
    const { isWriter } = this.getPerms(thingref, user)
    if (!isWriter) return null

    // set the thing's new attributes
    this._patchThing.run({ ref: thingref, patch: JSON.stringify(patch) })
  }

  createThing ({ groupref }, attributes, isPrivate) {
    // put new Thing into table with relevant attributes, and user assigned as its owner.
    // Attributes would be the arbitrary stuff.
    // Permissions is role based access stuff.
    let thing
    this.db.transaction(() => {
      thing = this._createThing.run({
        attributes: JSON.stringify(attributes)
      })
      this._createPerms.run(
        this.constructPerms(thing.lastInsertRowid, groupref, isPrivate)
      )
    })()
    return thing.lastInsertRowid
  }

  destroyThing (thingref, user) {
    const { isOwner } = this.getPerms(thingref, user)
    if (!isOwner) return null
    // checks to see if user has Destroy permissions then destroys the thing associated to the dbref.
    this._destroyThing.run({ ref: thingref })
  }

  addPermission (thingref, user, newUser, permission) {
    const { isOwner } = this.getPerms(thingref, user)
    if (!isOwner) return null
    this._addPermission(permission).run({
      thingref,
      newUserRef: newUser.groupref
    })
  }

  removePermission (thingref, user, removedUser, permission) {
    const { isOwner } = this.getPerms(thingref, user)
    if (!isOwner) return null
    this._removePermission(permission).run({
      thingref,
      removedUserRef: removedUser.groupref
    })
  }

  createGroup (user, groupName) {
    let group
    this.db.transaction(() => {
      const groupthing = this._createThing.run({
        attributes: JSON.stringify({ name: groupName, type: 'group' })
      })
      group = this._createGroup.run({
        name: groupName,
        users: JSON.stringify([user.ref]),
        thingref: groupthing.lastInsertRowid
      })
      this._createPerms.run(
        this.constructPerms(
          groupthing.lastInsertRowid,
          group.lastInsertRowid,
          true
        )
      )
    })()
    return group.lastInsertRowid
  }

  addUserToGroup (groupref, user, newUser) {
    const { isOwner } = this.getPerms(groupref, user)
    if (!isOwner) return null

    this._addToGroup.run({
      thingref: groupref,
      user: user.ref
    })
  }

  removeUserFromGroup (groupref, user, removedUser) {
    const { isOwner } = this.getPerms(groupref, user)
    if (!isOwner) return null

    this._removeFromGroup.run({
      thingref: groupref,
      user: user.ref
    })
  }

  destroyGroup (groupref, user) {
    this.destroyThing(groupref, user)
  }
}
