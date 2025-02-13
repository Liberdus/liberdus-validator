import * as crypto from '../../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from './../../utils'
import * as config from './../../config'
import * as AccountsStorage from '../../storage/accountStorage'
import create from './../../accounts'
import { UserAccount, WrappedStates, Tx, TransactionKeys, NodeAccount, Accounts, AppReceiptData } from './../../@types'

export const validate_fields = (tx: Tx.DepositStake, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.nominator !== 'string' && utils.isValidAddress(tx.nominator) === false) {
    response.success = false
    response.reason = 'tx "nominator" field must be a string or valid address.'
    throw new Error(response.reason)
  }
  if (typeof tx.nominee !== 'string') {
    response.success = false
    response.reason = 'tx "nominee" field must be a string or valid address.'
    throw new Error(response.reason)
  }
  if (typeof tx.stake !== 'bigint' && tx.stake <= BigInt(0)) {
    response.success = false
    response.reason = 'tx "stake" field must be a bigint and stake must be greater than 0.'
    throw new Error(response.reason)
  }
  if (!tx.sign || !tx.sign.owner || !tx.sign.sig || tx.sign.owner !== tx.nominator) {
    response.success = false
    response.reason = 'not signed by nominator account'
    throw new Error(response.reason)
  }
  if (crypto.verifyObj(tx) === false) {
    response.success = false
    response.reason = 'incorrect signing'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.DepositStake, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const nominatorAccount: UserAccount = wrappedStates[tx.nominator] && wrappedStates[tx.nominator].data
  const nodeAccount: NodeAccount = wrappedStates[tx.nominee] && wrappedStates[tx.nominee].data
  if (typeof nominatorAccount === 'undefined' || nominatorAccount === null) {
    response.reason = 'nominator account does not exist'
    return response
  }
  let existingStake = BigInt(0)
  if (nominatorAccount.operatorAccountInfo) {
    if (nominatorAccount.operatorAccountInfo.nominee) {
      if (nominatorAccount.operatorAccountInfo.nominee !== tx.nominee) {
        response.reason = 'nominator account has already staked to a different nominee'
        return response
      }
    }
    if (nominatorAccount.operatorAccountInfo.stake) {
      existingStake = nominatorAccount.operatorAccountInfo.stake
    }
  }

  if (nodeAccount && nodeAccount.nominator) {
    if (nodeAccount.nominator !== tx.nominator) {
      response.reason = 'nominee account has already been staked to another nominator'
      return response
    }
  }
  const restakeCooldown = AccountsStorage.cachedNetworkAccount.current.restakeCooldown
  if (nodeAccount && nodeAccount.stakeTimestamp + restakeCooldown > Date.now()) {
    response.reason = `This node was staked within the last ${restakeCooldown / config.ONE_MINUTE} minutes. You can't stake more to this node yet!`
    return response
  }
  if (nominatorAccount.data.balance < tx.stake) {
    response.reason = `Nominator account has balance ${nominatorAccount.data.balance} less than the stake amount ${tx.stake}`
    return response
  }
  const minStakeAmountUsd = AccountsStorage.cachedNetworkAccount.current.stakeRequiredUsd
  const minStakeAmount = utils.scaleByStabilityFactor(minStakeAmountUsd, AccountsStorage.cachedNetworkAccount)
  if (tx.stake + existingStake < minStakeAmount) {
    response.reason = `Stake amount sent: ${tx.stake} is less than the minimum required stake amount: ${minStakeAmount}`
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.DepositStake,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const nominatorAccount: UserAccount = wrappedStates[tx.nominator].data
  const nodeAccount: NodeAccount = wrappedStates[tx.nominee] && wrappedStates[tx.nominee].data
  if (nominatorAccount.operatorAccountInfo == null) {
    nominatorAccount.operatorAccountInfo = {
      stake: BigInt(0),
      nominee: '',
      certExp: 0,
      operatorStats: {
        totalNodeReward: BigInt(0),
        totalNodePenalty: BigInt(0),
        totalNodeTime: 0,
        history: [],
        totalUnstakeReward: BigInt(0),
        unstakeCount: 0,
        lastStakedNodeKey: '',
      },
    }
  }
  const txFeeUsd = AccountsStorage.cachedNetworkAccount.current.transactionFee
  const txFee = utils.scaleByStabilityFactor(txFeeUsd, AccountsStorage.cachedNetworkAccount)
  // [TODO] check if the maintainance fee is also needed in deposit_stake tx
  const maintenanceFee = utils.maintenanceAmount(txTimestamp, nominatorAccount, AccountsStorage.cachedNetworkAccount)
  const totalAmountToDeduct = tx.stake + txFee + maintenanceFee
  if (nominatorAccount.data.balance < totalAmountToDeduct) {
    throw new Error('Nominator account does not have enough balance to stake')
  }
  nominatorAccount.data.balance -= totalAmountToDeduct
  nominatorAccount.operatorAccountInfo.stake += tx.stake
  nominatorAccount.operatorAccountInfo.nominee = tx.nominee
  nominatorAccount.operatorAccountInfo.certExp = 0
  nodeAccount.nominator = tx.nominator

  console.log('nodeAccount.stakeLock', nodeAccount.stakeLock, tx.stake)
  nodeAccount.stakeLock += tx.stake
  nodeAccount.stakeTimestamp = txTimestamp

  nominatorAccount.timestamp = txTimestamp
  nodeAccount.timestamp = txTimestamp
  // nominator.data.transactions.push({ ...tx, txId })

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.nominator,
    to: tx.nominee,
    type: tx.type,
    transactionFee: txFee,
    additionalInfo: {
      maintenanceFee,
      totalStake: nodeAccount.stakeLock,
    },
  }

  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)

  dapp.log('Applied deposit_stake tx', nominatorAccount, nodeAccount)
}

export const keys = (tx: Tx.DepositStake, result: TransactionKeys) => {
  result.sourceKeys = [tx.nominator]
  result.targetKeys = [tx.nominee]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.DepositStake, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.nominator, tx.nominee],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount | NodeAccount, accountId: string, tx: Tx.DepositStake, accountCreated = false) => {
  if (!account) {
    if (accountId === tx.nominee) {
      account = create.nodeAccount(accountId)
    } else if (accountId === tx.nominator) {
      throw new Error('Nominator account must already exist in order to perform the deposit_stake transaction')
    }
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
