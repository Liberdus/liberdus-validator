import * as crypto from '../crypto'
import axios from 'axios'
import { Shardus, ShardusTypes } from '@shardus/core'
import create from '../accounts'
import * as config from '../config'
import { Accounts, UserAccount, NetworkAccount, IssueAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys, AppReceiptData } from '../@types'

export const validate_fields = (tx: Tx.Email, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.signedTx !== 'object') {
    response.success = false
    response.reason = 'tx "signedTx" field must be an object.'
    throw new Error(response.reason)
  }

  const signedTx = tx.signedTx

  if (signedTx) {
    if (typeof signedTx !== 'object') {
      response.success = false
      response.reason = '"signedTx" must be a object.'
      throw new Error(response.reason)
    }
    if (typeof signedTx.sign !== 'object') {
      response.success = false
      response.reason = '"sign" property on signedTx must be an object.'
      throw new Error(response.reason)
    }
    if (typeof signedTx.from !== 'string') {
      response.success = false
      response.reason = '"From" must be a string.'
      throw new Error(response.reason)
    }
    if (typeof signedTx.emailHash !== 'string') {
      response.success = false
      response.reason = '"emailHash" must be a string.'
      throw new Error(response.reason)
    }
  }
  if (typeof tx.email !== 'string') {
    response.success = false
    response.reason = '"email" must be a string.'
    throw new Error(response.reason)
  }
  if (tx.email.length > 30) {
    response.success = false
    response.reason = '"Email" length must be less than 31 characters (30 max)'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Email, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const source: UserAccount = wrappedStates[tx.signedTx.from] && wrappedStates[tx.signedTx.from].data
  if (!source) {
    response.reason = 'no account associated with address in signed tx'
    return response
  }
  if (tx.signedTx.sign.owner !== tx.signedTx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx.signedTx) === false) {
    response.reason = 'incorrect signing'
    return response
  }
  if (tx.signedTx.emailHash !== crypto.hash(tx.email)) {
    response.reason = 'Hash of the email does not match the signed email hash'
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Email,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const source: UserAccount = wrappedStates[tx.signedTx.from].data
  const nodeId = dapp.getNodeId()
  const { address } = dapp.getNode(nodeId)
  const [closest] = dapp.getClosestNodes(tx.signedTx.from, 5)
  if (nodeId === closest) {
    const baseNumber = 99999
    const randomNumber = Math.floor(Math.random() * 899999) + 1
    const verificationNumber = baseNumber + randomNumber

    axios.post('http://arimaa.com/mailAPI/index.cgi', {
      from: 'liberdus.verify',
      to: `${tx.email}`,
      subject: 'Verify your email for liberdus',
      message: `Please verify your email address by sending a "verify" transaction with the number: ${verificationNumber}`,
      secret: 'Liberdus',
    })

    dapp.put({
      type: 'gossip_email_hash',
      nodeId,
      account: source.id,
      from: address,
      emailHash: tx.signedTx.emailHash,
      verified: crypto.hash(`${verificationNumber}`),
      timestamp: Date.now(),
    })
  }

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.signedTx.from,
    to: tx.signedTx.from,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied email tx', source)
}

export const keys = (tx: Tx.Email, result: TransactionKeys) => {
  result.sourceKeys = [tx.signedTx.from]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Email, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.signedTx.from],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}
export const createRelevantAccount = (dapp: Shardus, account: UserAccount, accountId: string, tx: Tx.Email, accountCreated = false) => {
  if (!account) {
    account = create.userAccount(accountId, tx.timestamp)
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
