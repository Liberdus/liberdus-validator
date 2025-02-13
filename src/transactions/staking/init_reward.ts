import { nestedCountersInstance, Shardus, ShardusTypes } from '@shardus/core'
import * as crypto from '../../crypto'
import { LiberdusFlags } from '../../config'
import { Tx, NodeAccount, WrappedStates, TransactionKeys, AppReceiptData } from '../../@types'
import * as AccountsStorage from '../../storage/accountStorage'
import { _sleep, generateTxId } from '../../utils'
import { TXTypes } from '..'
import { dapp } from '../..'

export async function injectInitRewardTx(shardus: Shardus, eventData: ShardusTypes.ShardusEvent): Promise<unknown> {
  const startTime = eventData.additionalData.txData.startTime
  let tx = {
    type: TXTypes.init_reward,
    nominee: eventData.publicKey,
    nodeActivatedTime: startTime,
    timestamp: shardus.shardusGetTime(),
  } as Tx.InitRewardTX

  // check if this node has node account data
  let wrappedData: ShardusTypes.WrappedData = await shardus.getLocalOrRemoteAccount(eventData.publicKey)
  if (wrappedData == null || wrappedData.data == null) {
    //try one more time
    wrappedData = await shardus.getLocalOrRemoteAccount(eventData.publicKey)
    if (wrappedData == null || wrappedData.data == null) {
      if (LiberdusFlags.VerboseLogs) console.log(`injectInitRewardTx failed cant find : ${eventData.publicKey}`)
      nestedCountersInstance.countEvent('liberdus-staking', `injectInitRewardTx failed cant find node`)
      return
    }
  }
  const nodeAccount = wrappedData.data as NodeAccount
  // check if the nodeAccount has nomimator data
  if (nodeAccount.nominator == null || nodeAccount.nominator === '') {
    if (LiberdusFlags.VerboseLogs) console.log(`injectInitRewardTx failed cant find nomimator : ${eventData.publicKey}`, nodeAccount)
    nestedCountersInstance.countEvent('liberdus-staking', `injectInitRewardTx failed cant find nomimator`)
    return
  }
  // check if nodeAccount.rewardStartTime is already set to eventData.time
  if (nodeAccount.rewardStartTime >= tx.nodeActivatedTime) {
    if (LiberdusFlags.VerboseLogs) console.log(`injectInitRewardTx failed rewardStartTime already set : ${eventData.publicKey}`, nodeAccount)
    nestedCountersInstance.countEvent('liberdus-staking', `injectInitRewardTx failed rewardStartTime already set`)
    return
  }

  // to make sure that different nodes all submit an equivalent tx that is counted as the same tx,
  // we need to make sure that we have a deterministic timestamp
  const cycleEndTime = eventData.time
  let futureTimestamp = cycleEndTime * 1000
  while (futureTimestamp < shardus.shardusGetTime()) {
    futureTimestamp += 30 * 1000
  }
  const waitTime = futureTimestamp - shardus.shardusGetTime()
  tx.timestamp = futureTimestamp
  // since we have to pick a future timestamp, we need to wait until it is time to submit the tx
  await _sleep(waitTime)

  tx = shardus.signAsNode(tx)
  if (LiberdusFlags.VerboseLogs) {
    const txId = generateTxId(tx)
    console.log(`injectInitRewardTx: tx.timestamp: ${tx.timestamp} txid: ${txId}`, tx)
  }
  return await shardus.put(tx)
}

export const validate_fields = (tx: Tx.InitRewardTX, response: ShardusTypes.IncomingTransactionResult) => {
  if (LiberdusFlags.VerboseLogs) console.log('Validating InitRewardTX fields', tx)
  if (!tx.nominee || tx.nominee === '' || tx.nominee.length !== 64) {
    if (LiberdusFlags.VerboseLogs) console.log('validateFields InitRewardTX fail invalid nominee field', tx)
    nestedCountersInstance.countEvent('liberdus-staking', `validateFields InitRewardTX fail invalid nominee field`)
    response.success = false
    response.reason = 'invalid nominee field in setRewardTimes Tx'
    throw new Error(response.reason)
  }
  if (!tx.nodeActivatedTime) {
    if (LiberdusFlags.VerboseLogs) console.log('validateFields InitRewardTX fail nodeActivatedTime missing', tx)
    nestedCountersInstance.countEvent('liberdus-staking', `validateFields InitRewardTX fail nodeActivatedTime missing`)
    response.success = false
    response.reason = 'nodeActivatedTime field is not found in setRewardTimes Tx'
    throw new Error(response.reason)
  }
  if (tx.nodeActivatedTime < 0 || tx.nodeActivatedTime > dapp.shardusGetTime()) {
    if (LiberdusFlags.VerboseLogs) console.log('validateFields InitRewardTX fail nodeActivatedTime is not correct ', tx)
    nestedCountersInstance.countEvent('liberdus-staking', `validateFields InitRewardTX fail nodeActivatedTime is not correct`)
    response.success = false
    response.reason = 'nodeActivatedTime field is not correct in setRewardTimes Tx'
    throw new Error(response.reason)
  }
  const isValid = crypto.verifyObj(tx, true)
  if (!isValid) {
    if (LiberdusFlags.VerboseLogs) console.log('validateFields InitRewardTX fail invalid signature', tx)
    nestedCountersInstance.countEvent('liberdus-staking', `validateFields InitRewardTX fail invalid signature`)
    response.success = false
    response.reason = 'invalid signature in setRewardTimes Tx'
    throw new Error(response.reason)
  }
  if (LiberdusFlags.VerboseLogs) console.log('validateFields InitRewardTX success', tx)
  return response
}

export const validate = (tx: Tx.InitRewardTX, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  if (LiberdusFlags.VerboseLogs) console.log('Validating InitRewardTX', tx)
  const nodeAccount = wrappedStates[tx.nominee].data as NodeAccount
  // TODO: make sure this is a valid node account

  // check if nodeAccount.rewardStartTime is already set to tx.nodeActivatedTime
  if (nodeAccount.rewardStartTime >= tx.nodeActivatedTime) {
    if (LiberdusFlags.VerboseLogs) console.log('validateInitRewardTX fail rewardStartTime already set', tx)
    nestedCountersInstance.countEvent('liberdus-staking', `validateInitRewardTX fail rewardStartTime already set`)
    response.reason = 'rewardStartTime is already set'
    return response
  }
  if (nodeAccount.timestamp >= tx.timestamp) {
    if (LiberdusFlags.VerboseLogs) console.log('validateInitRewardTX fail timestamp already set', tx)
    nestedCountersInstance.countEvent('liberdus-staking', `validateInitRewardTX fail timestamp already set`)
    response.reason = 'timestamp is already set'
    return response
  }
  if (LiberdusFlags.VerboseLogs) console.log('validateInitRewardTX success', tx)
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.InitRewardTX,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const nodeAccount = wrappedStates[tx.nominee].data as NodeAccount
  const network = AccountsStorage.cachedNetworkAccount
  nodeAccount.rewardStartTime = tx.nodeActivatedTime
  nodeAccount.rewardEndTime = 0
  nodeAccount.timestamp = txTimestamp
  nodeAccount.rewardRate = network ? network.current.nodeRewardAmountUsd : BigInt(0)

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.nominee,
    to: nodeAccount.nominator,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)

  nestedCountersInstance.countEvent('liberdus-staking', `Applied InitRewardTX`)
  dapp.log('Applied InitRewardTX for', tx.nominee)
}

export const keys = (tx: Tx.InitRewardTX, result: TransactionKeys) => {
  result.sourceKeys = [tx.nominee]
  result.targetKeys = []
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.InitRewardTX, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.nominee],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: NodeAccount, accountId: string, tx: Tx.InitRewardTX, accountCreated = false) => {
  if (!account) {
    throw new Error('Account must already exist in order to perform the init_reward transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
