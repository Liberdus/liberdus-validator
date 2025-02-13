import * as crypto from '../crypto'
import { VectorBufferStream } from '@shardus/core'
import { SerdeTypeIdent } from '.'
import {NodeAccount} from '../@types'
import { Utils } from '@shardus/types'

export const nodeAccount = (accountId: string): NodeAccount => {
  const account: NodeAccount = {
    id: accountId,
    type: 'NodeAccount',
    balance: BigInt(0),
    nodeRewardTime: 0,
    hash: '',
    timestamp: 0,
    nominator: '',
    stakeLock: BigInt(0),
    stakeTimestamp: 0,
    penalty: BigInt(0),
    nodeAccountStats: {
      totalReward: BigInt(0),
      totalPenalty: BigInt(0),
      history: [],
      lastPenaltyTime: 0,
      penaltyHistory: [],
    },
    rewardStartTime: 0,
    rewardEndTime: 0,
    reward: BigInt(0),
    rewardRate: BigInt(0),
  }
  account.hash = crypto.hashObj(account)
  return account
}


export const serializeNodeAccount = (stream: VectorBufferStream, inp: NodeAccount, root = false): void => {
  if(root){
    stream.writeUInt16(SerdeTypeIdent.NodeAccount)
  }
  stream.writeString(inp.id)
  stream.writeString(inp.type)
  stream.writeBigUInt64(inp.balance)
  stream.writeBigUInt64(BigInt(inp.nodeRewardTime))
  stream.writeString(inp.hash)
  stream.writeBigUInt64(BigInt(inp.timestamp))
  stream.writeString(inp.nominator)
  stream.writeBigUInt64(inp.stakeLock)
  stream.writeBigUInt64(BigInt(inp.stakeTimestamp))
  stream.writeBigUInt64(inp.penalty)
  stream.writeString(Utils.safeStringify(inp.nodeAccountStats.history))
  stream.writeBigUInt64(BigInt(inp.rewardStartTime))
  stream.writeBigUInt64(BigInt(inp.rewardEndTime))
  stream.writeBigUInt64(inp.reward)
  stream.writeBigUInt64(inp.rewardRate)
}

export const deserializeNodeAccount = (stream: VectorBufferStream, root = false): NodeAccount => {
  
    if(root && (stream.readUInt16() !== SerdeTypeIdent.NodeAccount)){
      throw new Error("Unexpected bufferstream for NodeAccount type");
    }
  
    return {
      id: stream.readString(),
      type: stream.readString(),
      balance: stream.readBigUInt64(),
      nodeRewardTime: Number(stream.readBigUInt64()),
      hash: stream.readString(),
      timestamp: Number(stream.readBigUInt64()),
      nominator: stream.readString(),
      stakeLock: stream.readBigUInt64(),
      stakeTimestamp: Number(stream.readBigUInt64()),
      penalty: stream.readBigUInt64(),
      nodeAccountStats: Utils.safeJsonParse(stream.readString()),
      rewardStartTime: Number(stream.readBigUInt64()),
      rewardEndTime: Number(stream.readBigUInt64()),
      reward: stream.readBigUInt64(),
      rewardRate: stream.readBigUInt64(),
    }
  }
