import { UserAccount } from '../@types'
import { VectorBufferStream } from '@shardus/core'
import * as crypto from '@shardus/crypto-utils'
import { deserializeDeveloperPayment, SerdeTypeIdent, serializeDeveloperPayment } from '.'
import * as utils from '../utils'

export const userAccount = (accountId: string, timestamp: number) => {
  const account: UserAccount = {
    id: accountId,
    type: 'UserAccount',
    data: {
      balance: utils.libToWei(50),
      stake: BigInt(0),
      remove_stake_request: null,
      toll: null,
      chats: {},
      chatTimestamp: 0,
      friends: {},
      payments: [],
    },
    alias: null,
    emailHash: null,
    verified: false,
    hash: '',
    claimedSnapshot: false,
    lastMaintenance: timestamp,
    timestamp: 0,
    publicKey: '',
  }
  account.hash = crypto.hashObj(account)
  return account
}

export const serializeUserAccount = (stream: VectorBufferStream, inp: UserAccount, root = false): void => {
  if (root) {
    stream.writeUInt16(SerdeTypeIdent.UserAccount)
  }

  stream.writeString(inp.id)
  stream.writeString(inp.type)
  stream.writeBigUInt64(inp.data.balance)

  stream.writeUInt8(inp.data.toll ? 1 : 0)

  if (inp.data.toll) {
    stream.writeBigInt64(inp.data.toll)
  }
  stream.writeUInt32(Object.keys(inp.data.chats).length)
  for (const key in inp.data.chats) {
    stream.writeString(key)
    const chatObject = inp.data.chats[key]
    stream.writeUInt32(chatObject.receivedTimestamp)
    stream.writeString(chatObject.chatId)
  }
  stream.writeUInt32(inp.data.chatTimestamp)

  stream.writeUInt32(Object.keys(inp.data.friends).length)
  for (const key in inp.data.friends) {
    stream.writeString(key)
    stream.writeString(inp.data.friends[key])
  }

  if (inp.data.stake !== null) {
    stream.writeUInt8(1)
    stream.writeBigUInt64(inp.data.stake)
  } else {
    stream.writeUInt8(0)
  }

  if (inp.data.remove_stake_request !== null) {
    stream.writeUInt8(1)
    stream.writeUInt32(inp.data.remove_stake_request)
  } else {
    stream.writeUInt8(0)
  }

  stream.writeUInt32(inp.data.payments.length)
  for (let i = 0; i < inp.data.payments.length; i++) {
    serializeDeveloperPayment(stream, inp.data.payments[i])
  }

  stream.writeUInt8(inp.alias ? 1 : 0)
  if (inp.alias) {
    stream.writeString(inp.alias)
  }
  stream.writeUInt8(inp.emailHash ? 1 : 0)
  if (inp.emailHash) {
    stream.writeString(inp.emailHash)
  }

  stream.writeUInt8(inp.verified ? 1 : 0)
  stream.writeUInt32(inp.lastMaintenance)
  stream.writeUInt8(inp.claimedSnapshot ? 1 : 0)
  stream.writeUInt32(inp.timestamp)
  stream.writeString(inp.hash)
  stream.writeString(inp.publicKey)
}

export const deserializeUserAccount = (stream: VectorBufferStream, root = false): UserAccount => {
  if (root && stream.readUInt16() !== SerdeTypeIdent.UserAccount) {
    throw new Error('Unexpected type identifier for UserAccount type')
  }

  const id = stream.readString()
  const type = stream.readString()

  // Deserialize 'data'
  const balance = stream.readBigUInt64()

  // Optional toll
  let toll = null
  if (stream.readUInt8() === 1) {
    toll = stream.readBigInt64()
  }

  // Deserialize chats
  const chats = {} as UserAccount['data']['chats']
  const chatCount = stream.readUInt32()
  for (let i = 0; i < chatCount; i++) {
    const key = stream.readString()
    const receivedTimestamp = stream.readUInt32()
    const chatId = stream.readString()
    // eslint-disable-next-line security/detect-object-injection
    chats[key] = {
      receivedTimestamp,
      chatId,
    }
  }

  // Deserialize chatTimestamp
  const chatTimestamp = stream.readUInt32()

  // Deserialize friends
  const friends: Record<string, string> = {}
  const friendsCount = stream.readUInt32()
  for (let i = 0; i < friendsCount; i++) {
    const key = stream.readString()
    const value = stream.readString()
    friends[key] = value
  }

  // Optional stake
  let stake = null
  if (stream.readUInt8() === 1) {
    stake = stream.readBigUInt64()
  }

  // Optional remove_stake_request
  let remove_stake_request = null
  if (stream.readUInt8() === 1) {
    remove_stake_request = stream.readUInt32()
  }

  // Deserialize payments
  const payments = []
  const paymentsLength = stream.readUInt32()
  for (let i = 0; i < paymentsLength; i++) {
    payments.push(deserializeDeveloperPayment(stream))
  }

  // Optional alias
  let alias = null
  if (stream.readUInt8() === 1) {
    alias = stream.readString()
  }

  // Optional emailHash
  let emailHash = null
  if (stream.readUInt8() === 1) {
    emailHash = stream.readString()
  }

  // Deserialize verified flag
  const verified = stream.readUInt8() === 1

  // Deserialize lastMaintenance
  const lastMaintenance = stream.readUInt32()

  // Deserialize claimedSnapshot
  const claimedSnapshot = stream.readUInt8() === 1

  // Deserialize timestamp
  const timestamp = stream.readUInt32()

  // Deserialize hash
  const hash = stream.readString()

  const publicKey = stream.readString()

  return {
    id,
    type,
    data: {
      balance,
      stake,
      remove_stake_request,
      toll,
      chats,
      chatTimestamp,
      friends,
      payments,
    },
    alias,
    emailHash,
    verified,
    hash,
    claimedSnapshot,
    lastMaintenance,
    timestamp,
    publicKey,
  }
}
