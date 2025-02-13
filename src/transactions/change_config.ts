import { Shardus, ShardusTypes } from '@shardus/core'
import * as config from '../config'
import { UserAccount, NetworkAccount, WrappedStates, OurAppDefinedData, Tx, TransactionKeys, AppReceiptData } from '../@types'
import { TXTypes } from '.'
import { Utils } from '@shardus/types'

export const validate_fields = (tx: Tx.ChangeConfig, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string'
    throw new Error(response.reason)
  }
  if (typeof tx.cycle !== 'number') {
    response.success = false
    response.reason = 'tx "cycle" field must be a number'
    throw new Error(response.reason)
  }
  if (typeof tx.config !== 'string') {
    response.success = false
    response.reason = 'tx "config" field must be a string'
    throw new Error(response.reason)
  }
  try {
    const parsed = JSON.parse(tx.config)
    console.log('validate_fields Tx.ChangeConfig: ', parsed)
  } catch (err) {
    response.success = false
    response.reason = 'tx "change_config" field must be a valid JSON string'
    console.log('validate_fields tx "change_config" field must be a valid JSON string', err)
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.ChangeConfig, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const parsedConfig = JSON.parse(tx.config)
  dapp.log('Tx.ChangeConfig: ', parsedConfig)
  // [TODO] Validate parsed config
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.ChangeConfig,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: UserAccount = wrappedStates[tx.from].data
  let changeOnCycle
  let cycleData: ShardusTypes.Cycle

  if (tx.cycle === -1) {
    ;[cycleData] = dapp.getLatestCycles()
    changeOnCycle = cycleData.counter + 3
  } else {
    changeOnCycle = tx.cycle
  }

  const when = txTimestamp + config.ONE_SECOND * 10
  const value = {
    type: TXTypes.apply_change_config,
    timestamp: when,
    network: config.networkAccount,
    change: { cycle: changeOnCycle, change: Utils.safeJsonParse(tx.config) },
  }

  const addressHash = wrappedStates[config.networkAccount].stateId
  const ourAppDefinedData = applyResponse.appDefinedData as OurAppDefinedData

  ourAppDefinedData.globalMsg = { address: config.networkAccount, addressHash, value, when, source: from.id }

  from.timestamp = tx.timestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: config.networkAccount,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied change_config tx')
}

export const transactionReceiptPass = (tx: Tx.ChangeConfig, txId: string, wrappedStates: WrappedStates, dapp, applyResponse) => {
  let { address, addressHash, value, when, source } = applyResponse.appDefinedData.globalMsg
  dapp.setGlobal(address, addressHash, value, when, source)
  dapp.log('PostApplied change_config tx')
}

export const keys = (tx: Tx.ChangeConfig, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.ChangeConfig, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount, accountId: string, tx: Tx.ChangeConfig, accountCreated = false) => {
  if (!account) {
    throw Error('Account must exist in order to perform a change_config transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
