import stringify from 'fast-stable-stringify'
import Shardus from 'shardus-global-server/src/shardus/shardus-types'

export const validate_fields = (tx: Tx.ApplyDevParameters, response: Shardus.IncomingTransactionResult) => {
  return response
}

export const validate = (tx: Tx.ApplyDevParameters, wrappedStates: WrappedStates, response: Shardus.IncomingTransactionResult, dapp: Shardus) => {
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (tx: Tx.ApplyDevParameters, txId: string, wrappedStates: WrappedStates, dapp: Shardus) => {
  const network: NetworkAccount = wrappedStates[tx.network].data
  network.devWindows = tx.devWindows
  network.nextDevWindows = tx.nextDevWindows
  network.developerFund = tx.developerFund
  network.nextDeveloperFund = tx.nextDeveloperFund
  network.devIssue = tx.devIssue
  network.timestamp = tx.timestamp
}

export const keys = (tx: Tx.ApplyDevParameters, result: TransactionKeys) => {
  result.targetKeys = [tx.network]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}
