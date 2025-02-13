import * as crypto from '../crypto'
import { VectorBufferStream } from '@shardus/core'
import { Utils } from '@shardus/types'
import { SerdeTypeIdent } from '.'
import {ChatAccount} from '../@types'

export const chatAccount = (accountId: string): ChatAccount => {
  const chat: ChatAccount = {
    id: accountId,
    type: 'ChatAccount',
    messages: [],
    timestamp: 0,
    hash: '',
  }
  chat.hash = crypto.hashObj(chat)
  return chat
}

export const serializeChatAccount = (stream: VectorBufferStream, inp: ChatAccount, root = false): void => {
  if(root){
    stream.writeUInt16(SerdeTypeIdent.ChatAccount)
  }
  
  stream.writeString(inp.id)
  stream.writeString(inp.type)
  // [] Might have to update the serialization used for messages as it has updated to an array of object ( TxMessage )
  stream.writeString(Utils.safeStringify(inp.messages))
  stream.writeBigUInt64(BigInt(inp.timestamp))
  stream.writeString(inp.hash)
}


export const deserializeChatAccount = (stream: VectorBufferStream, root = false): ChatAccount => {

  if(root && (stream.readUInt16() !== SerdeTypeIdent.ChatAccount)){
    throw new Error("Unexpected bufferstream for ChatAccount type");
  }

  return {
    id: stream.readString(),
    type: stream.readString(),
    messages: Utils.safeJsonParse(stream.readString()),
    timestamp: Number(stream.readBigUInt64()),
    hash: stream.readString()
  }
}

