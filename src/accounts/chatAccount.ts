import * as crypto from '../crypto'
import { VectorBufferStream } from '@shardus/core'
import { Utils } from '@shardus/types'
import { SerdeTypeIdent } from '.'
import { ChatAccount } from '../@types'

export const chatAccount = (accountId: string): ChatAccount => {
  const chat: ChatAccount = {
    id: accountId,
    type: 'ChatAccount',
    messages: [],
    toll: {
      required: [1, 1],
      payOnRead: [0n, 0n],
      payOnReply: [0n, 0n],
    },
    read: [0, 0],
    replied: [0, 0],
    timestamp: 0,
    hash: '',
    hasChats: false,
  }
  chat.hash = crypto.hashObj(chat)
  return chat
}

export const serializeChatAccount = (stream: VectorBufferStream, inp: ChatAccount, root = false): void => {
  if (root) {
    stream.writeUInt16(SerdeTypeIdent.ChatAccount)
  }

  stream.writeString(inp.id)
  stream.writeString(inp.type)

  // Write messages array
  stream.writeString(Utils.safeStringify(inp.messages))

  // Write toll data
  stream.writeUInt8(inp.toll.required[0])
  stream.writeUInt8(inp.toll.required[1])
  stream.writeBigUInt64(inp.toll.payOnRead[0])
  stream.writeBigUInt64(inp.toll.payOnRead[1])
  stream.writeBigUInt64(inp.toll.payOnReply[0])
  stream.writeBigUInt64(inp.toll.payOnReply[1])

  // Write read/reply timestamps
  stream.writeBigUInt64(BigInt(inp.read[0]))
  stream.writeBigUInt64(BigInt(inp.read[1]))
  stream.writeBigUInt64(BigInt(inp.replied[0]))
  stream.writeBigUInt64(BigInt(inp.replied[1]))

  stream.writeBigUInt64(BigInt(inp.timestamp))
  stream.writeString(inp.hash)
  // write chatAcocunt.hasChats
  stream.writeUInt8(inp.hasChats ? 1 : 0)
}

export const deserializeChatAccount = (stream: VectorBufferStream, root = false): ChatAccount => {
  if (root && stream.readUInt16() !== SerdeTypeIdent.ChatAccount) {
    throw new Error('Unexpected bufferstream for ChatAccount type')
  }

  return {
    id: stream.readString(),
    type: stream.readString(),
    messages: Utils.safeJsonParse(stream.readString()),
    toll: {
      required: [stream.readUInt8(), stream.readUInt8()],
      payOnRead: [stream.readBigUInt64(), stream.readBigUInt64()],
      payOnReply: [stream.readBigUInt64(), stream.readBigUInt64()],
    },
    read: [Number(stream.readBigUInt64()), Number(stream.readBigUInt64())],
    replied: [Number(stream.readBigUInt64()), Number(stream.readBigUInt64())],
    timestamp: Number(stream.readBigUInt64()),
    hash: stream.readString(),
    hasChats: stream.readUInt8() === 1,
  }
}
