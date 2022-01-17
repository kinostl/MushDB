import MushDB from './mush_db.mjs'

const mushDb = new MushDB(':memory:')
const user = mushDb.createUser('test', 'test')
console.log('new user', user)
mushDb.createThing(user, { name: 'Test Object' }, true)
const createdThing = mushDb.createThing(user, { name: 'Test Object' })
console.log('createdThing', createdThing)

console.log('things')
console.table(mushDb.db.prepare('SELECT * FROM things').all())
console.log('users')
console.table(
  mushDb.db
    .prepare('SELECT * FROM users')
    .all()
    .map(curr => ({
      ...curr,
      password: '*****'
    }))
)
console.log('groups')
console.table(mushDb.db.prepare('SELECT * FROM groups').all())
console.log('perms (ids are all group ids)')
console.log('users all have proxy groups')
console.table(mushDb.db.prepare('SELECT * FROM permissions').all())

mushDb.addPermission(1, user, user, 'owners')
console.table(mushDb.db.prepare('SELECT * FROM permissions').all())
console.log('json test')
console.table(
  mushDb.db
    .prepare(
      "SELECT json_extract(attributes, '$.name') AS json_extracted_name FROM things"
    )
    .all()
)

console.log('perms checks')
console.log(mushDb._checkPerms.get({ thingref: 3, groupref: 1 }))
console.log(mushDb._checkPerms.get({ thingref: 3, groupref: 2 }))
console.log(mushDb._checkPerms.get({ thingref: 2, groupref: 2 }))

console.log('getPerms check')
console.log(mushDb.getPerms(3, user))
console.log(mushDb.getPerms(3, { groupref: 'guest' }))

console.log('getThing check')
console.log(mushDb.getThing(1, user))
console.log(mushDb.getThing(3, user))
console.log(mushDb.getThing(3, { groupref: 'guest' }))

console.log('update thing')
mushDb.patchThing(createdThing, user, {
  name: 'Edit Test Object',
  title: 'New Moon'
})
console.log(mushDb.getThing(createdThing, user))

console.log('update thing 2')
mushDb.patchThing(
  createdThing,
  { groupref: 5 },
  {
    name: 'Edit Test Object 2',
    title: 'Twilight'
  }
)
console.log(mushDb.getThing(createdThing, user))
console.log(mushDb.getThing(createdThing, { groupref: 5 }))

console.log('update thing 3')
mushDb.patchThing(createdThing, user, {
  name: 'Edit Test Object',
  title: null,
  description: 'I do not like movies'
})
console.log(mushDb.getThing(createdThing, user))

console.log('Destroy thing')
mushDb.destroyThing(createdThing, user)
console.log(mushDb.getThing(createdThing, user))

mushDb.removePermission(1, user, user, 'owners')
console.table(mushDb.db.prepare('SELECT * FROM permissions').all())
