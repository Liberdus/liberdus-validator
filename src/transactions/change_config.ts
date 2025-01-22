import { Shardus, ShardusTypes } from '@shardus/core'
import * as LiberdusTypes from '../@types'
import * as config from '../config'
import * as utils from '../utils'
import { UserAccount, NetworkAccount, WrappedStates, OurAppDefinedData, Tx, TransactionKeys } from '../@types'
import { TXTypes } from '.'
import { Utils } from '@shardus/types'
import { toShardusAddress } from '../utils/address'

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
) => {
  const from: UserAccount = wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  let changeOnCycle
  let cycleData: ShardusTypes.Cycle

  if (tx.cycle === -1) {
    ;[cycleData] = dapp.getLatestCycles()
    changeOnCycle = cycleData.counter + 3
  } else {
    changeOnCycle = tx.cycle
  }

  const when = txTimestamp + config.ONE_SECOND * 10
  let value = {
    type: TXTypes.apply_change_config,
    timestamp: when,
    network: config.networkAccount,
    change: { cycle: changeOnCycle, change: Utils.safeJsonParse(tx.config) },
  }

  const addressHash = wrappedStates[config.networkAccount].stateId
  const ourAppDefinedData = applyResponse.appDefinedData as OurAppDefinedData

  ourAppDefinedData.globalMsg = { address: config.networkAccount, addressHash, value, when, source: from.id }

  from.timestamp = tx.timestamp
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

export const collectWrappedStates = async (tx: Tx.ChangeConfig, dapp: Shardus): Promise<WrappedStates> => {
  const promises = []
  const accounts = [config.networkAccount]
  const wrappedStates: WrappedStates = {}
  const txTimestamp = utils.getInjectedOrGeneratedTimestamp({ tx: tx }, dapp)

  for (const accountId of accounts) {
    const shardusId = toShardusAddress(accountId)
    promises.push(dapp.getLocalOrRemoteAccount(shardusId).then((queuedWrappedState)=>{
      wrappedStates[shardusId] = {
        accountId: queuedWrappedState.accountId,
        stateId: queuedWrappedState.stateId,
        data: queuedWrappedState.data as LiberdusTypes.Accounts,
        timestamp: txTimestamp,
      }
    }))
  }

  await Promise.allSettled(promises)
  return wrappedStates 
}


