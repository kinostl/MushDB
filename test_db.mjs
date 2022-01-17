import MushDB from './mush_db.mjs'

const mushDb = new MushDB(':memory:')
const user = mushDb.signUp('test', 'test')
console.log('new user', user)
mushDb.create(user, { name: 'Test Object' })

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

console.log('json test')
console.table(
  mushDb.db
    .prepare(
      "SELECT json_extract(attributes, '$.name') AS json_extracted_name FROM things"
    )
    .all()
)

console.log('perms checks')
console.log(mushDb._checkPerms.get({ thingref: 2, groupref: 1 }))
console.log(mushDb._checkPerms.get({ thingref: 2, groupref: 'guest' }))

console.log('getPerms check')
console.log(mushDb.getPerms(2, user))
console.log(mushDb.getPerms(2, { groupref: 'guest' }))

console.log('getThing check')
console.log(mushDb.getThing(1, user))
