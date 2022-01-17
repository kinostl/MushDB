import Database from 'better-sqlite3'
import {
  generateKeyPairSync,
  privateEncrypt,
  publicEncrypt,
  privateDecrypt,
  publicDecrypt
} from 'crypto'

const path = ':memory:'
const passphrase = 'top secret'
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase
  }
})

const db = new Database(path)
db.prepare(
  `CREATE TABLE IF NOT EXISTS users (
    name STRING UNIQUE, 
    privateKey STRING, 
    publicKey STRING
  )`
).run()
const _createThing = db.prepare(
  'INSERT INTO users VALUES ($name, $privateKey, $publicKey)'
)
const _getThing = db.prepare('SELECT * FROM users WHERE name=$name')

const signForPrivate = publicEncrypt(
  {
    key: publicKey,
    passphrase
  },
  'Public Hello'
)

console.log(signForPrivate)
const signForPublic = privateEncrypt(
  {
    key: privateKey,
    passphrase
  },
  'Private Hello'
)
console.log(signForPublic)

_createThing.run({ name: 'test user', privateKey, publicKey })
const { privateKey: dbPrivateKey, publicKey: dbPublicKey } = _getThing.get({
  name: 'test user'
})

console.log(
  privateDecrypt(
    {
      key: dbPrivateKey,
      passphrase
    },
    signForPrivate
  ).toString('utf8')
)
console.log(
  publicDecrypt({ key: dbPublicKey, passphrase }, signForPublic).toString(
    'utf8'
  )
)
