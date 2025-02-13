import * as crypto from '../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import create from '../accounts'
import { isValidUncompressedPublicKey, getAddressFromPublicKey } from '../utils/address'
import * as config from '../config'
import { AliasAccount, UserAccount, NetworkAccount, IssueAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys, AppReceiptData } from '../@types'

export const validate_fields = (tx: Tx.Register, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.aliasHash !== 'string') {
    response.success = false
    response.reason = 'tx "aliasHash" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.alias !== 'string') {
    response.success = false
    response.reason = 'tx "alias" field must be a string.'
    throw new Error(response.reason)
  }
  if (tx.alias.length >= 20) {
    response.success = false
    response.reason = 'tx "alias" field must be less than 21 characters (20 max)'
    throw new Error(response.reason)
  }
  if (/[^A-Za-z0-9]+/g.test(tx.alias)) {
    response.success = false
    response.reason = 'tx "alias" field may only contain alphanumeric characters'
    throw new Error(response.reason)
  }

  if (tx.aliasHash !== crypto.hash(tx.alias)) {
    response.success = false
    response.reason = 'alias hash does not match alias'
    throw new Error(response.reason)
  }

  if (crypto.verifyObj(tx) === false) {
    response.success = false
    response.reason = 'tx signature is incorrect'
    throw new Error(response.reason)
  }

  return response
}

export const validate = (tx: Tx.Register, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const from: UserAccount = wrappedStates[tx.from] && wrappedStates[tx.from].data
  const alias: AliasAccount = wrappedStates[tx.aliasHash] && wrappedStates[tx.aliasHash].data
  if (tx.sign.owner !== tx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
    return response
  }
  if (!alias) {
    response.reason = 'Alias account was not found for some reason'
    return response
  }
  if (from.alias !== null) {
    response.reason = 'User has already registered an alias'
    return response
  }
  if (alias.inbox === tx.alias) {
    response.reason = 'This alias is already taken'
    return response
  }
  if (/[^A-Za-z0-9]+/g.test(tx.alias)) {
    response.reason = 'Alias may only contain alphanumeric characters'
    return response
  }
  if (isValidUncompressedPublicKey(tx.publicKey) === false) {
    response.reason = 'Invalid public key'
    return response
  }

  // if (getAddressFromPublicKey(tx.publicKey) !== tx.from) {
  //   response.reason = 'Public key does not match the from address'
  //   return response
  // }

  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Register,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: UserAccount = wrappedStates[tx.from].data
  const alias: AliasAccount = wrappedStates[tx.aliasHash].data
  // from.data.balance -= network.current.transactionFee
  // from.data.balance -= maintenanceAmount(txTimestamp, from)
  alias.inbox = tx.alias
  from.alias = tx.alias
  from.publicKey = tx.publicKey
  alias.address = tx.from

  // from.data.transactions.push({ ...tx, txId })
  alias.timestamp = txTimestamp
  from.timestamp = txTimestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.aliasHash,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied register tx', from, alias)
}

export const keys = (tx: Tx.Register, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [tx.aliasHash]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Register, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from, tx.aliasHash],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount | AliasAccount, accountId: string, tx: Tx.Register, accountCreated = false) => {
  if (!account) {
    if (accountId === tx.aliasHash) {
      account = create.aliasAccount(accountId)
    } else {
      account = create.userAccount(accountId, tx.timestamp)
    }
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
