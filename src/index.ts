import {shardusFactory, ShardusTypes, nestedCountersInstance} from '@shardus/core'
import {P2P} from '@shardus/types'
import * as crypto from '@shardus/crypto-utils'
import * as configs from './config'
import {TOTAL_DAO_DURATION} from './config'
import * as utils from './utils'
import * as LiberdusTypes from './@types'
import dotenv from 'dotenv'
import transactions from './transactions'
import registerAPI from './api'
import stringify = require('fast-stable-stringify');
import config, { FilePaths, LiberdusFlags } from './config'
import { TXTypes } from './transactions'
import * as AccountsStorage from './storage/accountStorage'
const {version} = require('../package.json')


dotenv.config()
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

// THE ENTIRE APP STATE FOR THIS NODE

const env = process.env
const args = process.argv

// let defaultConfig = configs.initConfigFromFile()
// let config = configs.overrideDefaultConfig(defaultConfig, env, args)

const dapp = shardusFactory(config)

if (LiberdusFlags.UseDBForAccounts === true) {
  AccountsStorage.init(config.server.baseDir, `${FilePaths.LIBERDUS_DB}`)
}

// let logFlags = {}
// if(dapp.getLogFlags){
//   logFlags = dapp.getLogFlags()
// }
let statsDebugLogs = false

// API
registerAPI(dapp)

dapp.registerExternalGet('accounts', async (req, res): Promise<void> => {
  const accounts = await AccountsStorage.debugGetAllAccounts()
  res.json({ accounts })
})

// SDK SETUP FUNCTIONS
dapp.setup({
  async sync(): Promise<void> {
    dapp.useAccountWrites()
    if (dapp.p2p.isFirstSeed) {
      await utils._sleep(configs.ONE_SECOND * 5)

      const nodeId = dapp.getNodeId()
      const address = dapp.getNode(nodeId).address
      /**
       * [NOTE] [AS] Not sure why we're adding 10 secs to the timestamp but it
       * caused the network to not form up when the tx processing pipeline was
       * fixed to check timestamps properly
       */
        // const when = Date.now() + configs.ONE_SECOND * 10
      const when = dapp.shardusGetTime()
      const existingNetworkAccount = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
      if (existingNetworkAccount) {
        dapp.log('NETWORK_ACCOUNT ALREADY EXISTED: ', existingNetworkAccount)
        await utils._sleep(configs.ONE_SECOND * 5)
      } else {
        dapp.setGlobal(
          configs.networkAccount,
          {
            type: 'init_network',
            timestamp: when,
            network: configs.networkAccount,
          },
          when,
          configs.networkAccount
        )

        dapp.log(`node ${nodeId} GENERATED_A_NEW_NETWORK_ACCOUNT: `)
        await utils._sleep(configs.ONE_SECOND * 10)

        // WE SHOULD NOT DO THIS WHILE THE NETWORK IS FORMING
        // dapp.set({
        //   type: 'issue',
        //   network: configs.networkAccount,
        //   nodeId,
        //   from: address,
        //   issue: crypto.hash(`issue-${1}`),
        //   proposal: crypto.hash(`issue-${1}-proposal-1`),
        //   timestamp: Date.now(),
        // })
        // dapp.set({
        //   type: 'dev_issue',
        //   network: configs.networkAccount,
        //   nodeId,
        //   from: address,
        //   devIssue: crypto.hash(`dev-issue-${1}`),
        //   timestamp: Date.now(),
        // })
        await utils._sleep(configs.ONE_SECOND * 10)
      }
    } else {
      while (!(await dapp.getLocalOrRemoteAccount(configs.networkAccount))) {
        console.log('waiting..')
        await utils._sleep(1000)
      }
    }
  },
  validateTransaction(tx: any, wrappedStates: { [id: string]: LiberdusTypes.WrappedAccount }): ShardusTypes.IncomingTransactionResult {
    const response: ShardusTypes.IncomingTransactionResult = {
      success: false,
      reason: 'Transaction is not valid.',
      txnTimestamp: tx.timestamp,
    }

    return transactions[tx.type].validate(tx, wrappedStates, response, dapp)
  },
  // THIS NEEDS TO BE FAST, BUT PROVIDES BETTER RESPONSE IF SOMETHING GOES WRONG
  validate(timestampedTx: any, appData: any): { success: boolean; reason: string; status: number } {
    let {tx} = timestampedTx
    let txnTimestamp: number = utils.getInjectedOrGeneratedTimestamp(timestampedTx, dapp)

    // Validate tx fields here
    const response: ShardusTypes.IncomingTransactionResult = {
      success: true,
      reason: 'This transaction is valid!',
    }

    if (!txnTimestamp) {
      response.success = false
      response.reason = 'Invalid transaction timestamp'
      throw new Error(response.reason)
    }

    if (typeof tx.type !== 'string') {
      response.success = false
      response.reason = 'Tx "type" field must be a string.'
      throw new Error(response.reason)
    }
    if (transactions[tx.type] == undefined) {
      response.success = false
      response.reason = `The tx type ${tx.type} does not exist in the network.`
    }

    if (typeof txnTimestamp !== 'number') {
      response.success = false
      response.reason = 'Tx "timestamp" field must be a number.'
      throw new Error(response.reason)
    }
    return transactions[tx.type].validate_fields(tx, response)
  },
  getTimestampFromTransaction(tx: any) {
    return tx.timestamp ? tx.timestamp : 0
  },
  crack(timestampedTx: any, appData: any): LiberdusTypes.KeyResult {
    let {tx} = timestampedTx
    let txnTimestamp: number = utils.getInjectedOrGeneratedTimestamp(timestampedTx, dapp)
    const result = {
      sourceKeys: [],
      targetKeys: [],
      allKeys: [],
      timestamp: txnTimestamp
    } as LiberdusTypes.TransactionKeys
    const keys = transactions[tx.type].keys(tx, result)
    return {
      id: crypto.hashObj(tx),
      timestamp: txnTimestamp,
      keys,
      shardusMemoryPatterns: {
        ro: [],
        rw: [],
        wo: [],
        on: [],
        ri: [],
      }
    }
  },
  async apply(timestampedTx: ShardusTypes.OpaqueTransaction, wrappedStates ) {
    //@ts-ignore
    let {tx} = timestampedTx
    const txTimestamp = utils.getInjectedOrGeneratedTimestamp(timestampedTx, dapp)
    const {success, reason} = this.validateTransaction(tx, wrappedStates)

    if (success !== true) {
      throw new Error(`invalid transaction, reason: ${reason}. tx: ${stringify(tx)}`)
    }

    // Create an applyResponse which will be used to tell Shardus that the tx has been applied
    let txId: string = utils.generateTxId(tx)

    const applyResponse: ShardusTypes.ApplyResponse = dapp.createApplyResponse(txId, txTimestamp)

    transactions[tx.type].apply(tx, txTimestamp, txId, wrappedStates, dapp, applyResponse)

    for (const accountId in wrappedStates) {
      // only add the accounts that have changed
      if (wrappedStates[accountId].data?.['timestamp'] === txTimestamp) {
        // Update the stateId by calculating the hash for the update accounts for the global txs
        // TODO: This is a hack, we might want to add the change of calling calculateAccountHash() on shardus core for global txs
        // For normal txs, shardus core takes care of account stateId updates, see: https://github.com/shardeum/shardus-core/blob/8dd4807e952ff5424dfd2e322284e0d55f84b3a8/src/state-manager/TransactionConsensus.ts#L3574
        const wrappedChangedAccount = wrappedStates[accountId] as ShardusTypes.WrappedResponse
        if (
          tx.type === TXTypes.init_network ||
          tx.type === TXTypes.apply_change_config ||
          tx.type === TXTypes.apply_tally ||
          tx.type === TXTypes.apply_dev_tally ||
          tx.type === TXTypes.parameters ||
          tx.type === TXTypes.apply_parameters ||
          tx.type === TXTypes.dev_parameters ||
          tx.type === TXTypes.apply_dev_parameters ||
          tx.type === TXTypes.apply_developer_payment
        ) {
          const hashAfter = this.calculateAccountHash(wrappedStates[accountId].data)
          wrappedChangedAccount.stateId = hashAfter
          wrappedChangedAccount.timestamp = txTimestamp
        }
        dapp.applyResponseAddChangedAccount(applyResponse, accountId, wrappedChangedAccount, txId, txTimestamp)
      }
    }

    return applyResponse
  },
  transactionReceiptPass(timestampedTx: any, wrappedStates: { [id: string]: LiberdusTypes.WrappedAccount }, applyResponse: ShardusTypes.ApplyResponse) {
    let {tx} = timestampedTx
    let txId: string = utils.generateTxId(tx)
    try {
      if (transactions[tx.type].transactionReceiptPass)
        transactions[tx.type].transactionReceiptPass(tx, txId, wrappedStates, dapp, applyResponse)
    } catch (e) {
      console.log(`Error in transactionReceiptPass: ${e.message}`)
    }
  },
  async getStateId(accountAddress: string, mustExist = true): Promise<string> {
    const account = await AccountsStorage.getAccount(accountAddress)
    if ((typeof account === 'undefined' || account === null) && mustExist === true) {
      throw new Error('Could not get stateId for account ' + accountAddress)
    }
    return account.hash
  },
  async getAccountTimestamp(accountAddress: string, mustExist = true): Promise<number> {
    const account = await AccountsStorage.getAccount(accountAddress)
    if ((typeof account === 'undefined' || account === null) && mustExist === true) {
      throw new Error('Could not get getAccountTimestamp for account ' + accountAddress)
    }
    return account.timestamp
  },
  getTimestampAndHashFromAccount(accountData: any): { timestamp: number; hash: string } {
    const account: LiberdusTypes.Accounts = accountData as LiberdusTypes.Accounts
    // if ((typeof account === 'undefined' || account === null)) {
    //   throw new Error(`Could not get getAccountInfo for account ${stringify(accountData)} `)
    // }
    const timestamp = account.timestamp
    const hash = account.hash
    return {timestamp, hash}
  },
  async deleteLocalAccountData(): Promise<void> {
    await AccountsStorage.clearAccounts()
  },
  async setAccountData(accountRecords: LiberdusTypes.Accounts[]): Promise<void> {
    for (const account of accountRecords) {
      // possibly need to clone this so others lose their ref
      await AccountsStorage.setAccount(account.id,account)
    }
  },
  async getRelevantData(accountId: string, timestampedTx: any): Promise<ShardusTypes.WrappedResponse> {
    let {tx} = timestampedTx
    const account = await AccountsStorage.getAccount(accountId)
    let accountCreated = false
    return transactions[tx.type].createRelevantAccount(dapp, account, accountId, tx, accountCreated)
  },
  async updateAccountFull(wrappedData, localCache, applyResponse): Promise<void> {
    const accountId = wrappedData.accountId
    const accountCreated = wrappedData.accountCreated
    const updatedAccount = wrappedData.data as LiberdusTypes.Accounts
    // Update hash
    const hashBefore = updatedAccount.hash
    const hashAfter = this.calculateAccountHash(updatedAccount)
    // Save updatedAccount to db / persistent storage
    await AccountsStorage.setAccount(accountId, updatedAccount)
    // Add data to our required response object
    dapp.applyResponseAddState(
      applyResponse,
      updatedAccount,
      updatedAccount,
      accountId,
      applyResponse.txId,
      applyResponse.txTimestamp,
      hashBefore,
      hashAfter,
      accountCreated
    )
  },
  // TODO: This might be useful in making some optimizations
  updateAccountPartial(wrappedData, localCache, applyResponse) {
    this.updateAccountFull(wrappedData, localCache, applyResponse)
  },
  async getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords, offset = 0, accountOffset = ''): Promise<ShardusTypes.WrappedData[]> {
    const start = parseInt(accountStart, 16)
    const end = parseInt(accountEnd, 16)

    const finalResults: ShardusTypes.WrappedData[] = []

    if (LiberdusFlags.UseDBForAccounts === true) {
      //direct DB query
      const dbResults = await AccountsStorage.queryAccountsEntryByRanges2(accountStart, accountEnd, tsStart, tsEnd, maxRecords, offset, accountOffset)

      for (const account of dbResults) {
        // Process and add to finalResults
        const wrapped = {
          accountId: account.id,
          data: account,
          stateId: account.hash,
          timestamp: account.timestamp,
        }
        finalResults.push(wrapped)
      }
      return finalResults
    }

    const accounts = AccountsStorage.accounts
    const results: LiberdusTypes.Accounts[] = []
    // Loop all accounts
    for (const addressStr in accounts) {
      const account = accounts[addressStr] // eslint-disable-line security/detect-object-injection
      // Skip if not in account id range
      const id = parseInt(addressStr, 16)
      if (id < start || id > end) continue
      // Skip if not in timestamp range
      const timestamp = account.timestamp
      if (timestamp < tsStart || timestamp > tsEnd) continue

      // // Add to results
      results.push(account)
      // we can't exit early. this is hard on perf
      // This data needs to eventually live in a DB and then the sort and max records will be natural.

      // Return results early if maxRecords reached
      // if (results.length >= maxRecords) return results
    }
    //critical to sort by timestamp before we cull max records
    results.sort((a, b) => a.timestamp - b.timestamp)

    //let cappedResults = results.slice(0, maxRecords)

    const cappedResults = []
    let count = 0
    const extra = 0
    // let startTS = results[0].timestamp
    // let sameTS = true

    if (results.length > 0) {
      //start at offset!
      for (let i = offset; i < results.length; i++) {
        const account = results[i] // eslint-disable-line security/detect-object-injection
        // if(startTS === account.timestamp){
        //   sameTS = true
        // }
        // if(sameTS){
        //   if(startTS != account.timestamp){
        //     sameTS = false
        //   }
        // } else {
        //   if(count > maxRecords){
        //     break
        //   }
        // }
        if (count > maxRecords) {
          // if(lastTS != account.timestamp){
          //   break
          // } else {
          //   extra++
          // }

          break //no extras allowed
        }
        count++
        cappedResults.push(account)
      }
    }

    /* prettier-ignore */ dapp.log( `getAccountDataByRange: extra:${extra} ${JSON.stringify({ accountStart, accountEnd, tsStart, tsEnd, maxRecords, offset, })}` )

    for (const account of cappedResults) {
      // Process and add to finalResults
      const wrapped = {
        accountId: account.id,
        stateId: account.hash,
        data: account,
        timestamp: account.timestamp,
      }
      finalResults.push(wrapped)
    }

    return finalResults
  },
  async getAccountData(accountStart, accountEnd, maxRecords): Promise<LiberdusTypes.WrappedAccount[]> {
    const results: LiberdusTypes.WrappedAccount[] = []
    const start = parseInt(accountStart, 16)
    const end = parseInt(accountEnd, 16)

    if (LiberdusFlags.UseDBForAccounts === true) {
      //direct DB query
      const dbResults = await AccountsStorage.queryAccountsEntryByRanges(accountStart, accountEnd, maxRecords)

      for (const account of dbResults) {
        const wrapped = {
          accountId: account.id,
          stateId: account.hash,
          data: account,
          timestamp: account.timestamp,
        }
        results.push(wrapped)
      }
      return results
    }

    const accounts = AccountsStorage.accounts

    // Loop all accounts
    for (const account of Object.values(accounts)) {
      // Skip if not in account id range
      const id = parseInt(account.id, 16)
      if (id < start || id > end) continue

      // Add to results
      const wrapped = {
        accountId: account.id,
        stateId: account.hash,
        data: account,
        timestamp: account.timestamp,
      }
      results.push(wrapped)
      // Return results early if maxRecords reached
      if (results.length >= maxRecords) {
        results.sort((a, b) => a.timestamp - b.timestamp)
        return results
      }
    }
    results.sort((a, b) => a.timestamp - b.timestamp)
    return results
  },
  async getAccountDataByList(addressList: string[]): Promise<LiberdusTypes.WrappedAccount[]> {
    const results: LiberdusTypes.WrappedAccount[] = []
    for (const address of addressList) {
      const account = await AccountsStorage.getAccount(address)
      if (account) {
        const wrapped = {
          accountId: account.id,
          stateId: account.hash,
          data: account,
          timestamp: account.timestamp,
        }
        results.push(wrapped)
      }
    }
    results.sort((a, b) => parseInt(a.accountId, 16) - parseInt(b.accountId, 16))
    return results
  },
  calculateAccountHash(account: any): string {
    account.hash = '' // Not sure this is really necessary
    account.hash = crypto.hashObj(account)
    return account.hash
  },
  // TODO:Seems we don't use resetAccountData and deleteAccountData anymore
  async resetAccountData(accountBackupCopies: any[]): Promise<void> {
    for (const recordData of accountBackupCopies) {
      const accountData: LiberdusTypes.Accounts = recordData.data
      await AccountsStorage.setAccount(accountData.id, { ...accountData })
    }
  },
  deleteAccountData(addressList: string[]): void {
    stringify('DELETE_ACCOUNT_DATA', stringify(addressList))
    for (const address of addressList) {
      // delete accounts[address]
      console.log(`Deleting account ${address}... - which is not implemented`)
      // await AccountsStorage.deleteAccount(address) // TODO: Add deleteAccount function in AccountsStorage
    }
  },
  getAccountDebugValue(wrappedAccount: LiberdusTypes.WrappedAccount): string {
    return `${stringify(wrappedAccount)}`
  },
  canDebugDropTx(tx: any) {
    return tx.type === 'create';
  },
  close(): void {
    dapp.log('Shutting down server...')
    console.log('Shutting down server...')
  },
  //txSummaryUpdate: (blob: any, tx: any, wrappedStates: any) => void
  txSummaryUpdate(blob, tx, wrappedStates) {
    if (blob.initialized == null) {
      blob.initialized = true
      blob.txByType = {}
      blob.totalTx = 0
    }

    if (blob.txByType[tx.type] == null) {
      blob.txByType[tx.type] = 0
    }
    blob.txByType[tx.type]++
    blob.totalTx++
  },
  // dataSummaryInit: (blob: any, accountData: any) => void
  dataSummaryInit(blob, accountData) {
    if (blob.initialized == null) {
      blob.initialized = true
      blob.accByType = {}
      blob.totalBalance = 0
      blob.totalAccounts = 0
    }

    let accType = utils.getAccountType(accountData)
    if (blob.accByType[accType] == null) {
      blob.accByType[accType] = 0
    }
    blob.accByType[accType]++
    blob.totalAccounts++

    if (accType == 'UserAccount') {
      if (accountData.data.balance != null) {
        let blobBalanceBefore = blob.totalBalance
        let accountBalance = accountData.data.balance
        let totalBalance = blobBalanceBefore + accountBalance

        if (statsDebugLogs)
          dapp.log(`stats balance init ${blobBalanceBefore}+${accountBalance}=${totalBalance}  ${stringify(accountData.id)}`)

        if (totalBalance != null) {
          blob.totalBalance = totalBalance
        } else {
          if (statsDebugLogs)
            dapp.log(`error: null balance attempt. dataSummaryInit UserAccount 1 ${accountData.data.balance} ${stringify(accountData.id)}`)
        }
      } else {
        if (statsDebugLogs)
          dapp.log(`error: null balance attempt. dataSummaryInit UserAccount 2 ${accountData.data.balance} ${stringify(accountData.id)}`)
      }
    }
    if (accType == 'NodeAccount') {
      if (accountData.balance != null) {
        let totalBalance = blob.totalBalance + accountData.balance
        if (totalBalance != null) {
          blob.totalBalance = totalBalance
        } else {
          if (statsDebugLogs)
            dapp.log(`error: null balance attempt. dataSummaryInit NodeAccount 1 ${accountData.balance} ${stringify(accountData.id)}`)
        }
      } else {
        if (statsDebugLogs)
          dapp.log(`error: null balance attempt. dataSummaryInit NodeAccount 2 ${accountData.balance} ${stringify(accountData.id)}`)
      }
    }
  },
  // dataSummaryUpdate: (blob: any, accountDataBefore: any, accountDataAfter: any) => void
  dataSummaryUpdate(blob, accountDataBefore, accountDataAfter) {
    if (blob.initialized == null) {
      //should not ever get here though.
      blob.initialized = true
      blob.accByType = {}
      blob.totalBalance = 0
      blob.totalAccounts = 0
    }
    let accType = utils.getAccountType(accountDataAfter)

    if (accType == 'UserAccount') {
      let blobBalanceBefore = blob.totalBalance
      let accountBalanceBefore = accountDataBefore.data.balance
      let accountBalanceAfter = accountDataAfter.data.balance
      let balanceChange = accountDataAfter.data.balance - accountDataBefore.data.balance

      let totalBalance = blob.totalBalance + balanceChange
      if (statsDebugLogs)
        dapp.log(
          `stats balance update ${blobBalanceBefore}+${balanceChange}(${accountBalanceAfter}-${accountBalanceBefore})=${totalBalance}  ${stringify(
            accountDataAfter.id
          )}`
        )

      if (balanceChange != null) {
        totalBalance = blob.totalBalance + balanceChange
        if (totalBalance != null) {
          blob.totalBalance = totalBalance
        } else {
          if (statsDebugLogs)
            dapp.log(
              `error: null balance attempt. dataSummaryUpdate UserAccount 1 ${accountDataAfter.data.balance} ${stringify(accountDataAfter.id)} ${accountDataBefore.data.balance} ${stringify(accountDataBefore.id)}`
            )
        }
      } else {
        if (statsDebugLogs)
          dapp.log(
            `error: null balance attempt. dataSummaryUpdate UserAccount 2 ${accountDataAfter.data.balance} ${stringify(accountDataAfter.id)} ${accountDataBefore.data.balance} ${stringify(accountDataBefore.id)}`
          )
      }
    }
    if (accType == 'NodeAccount') {
      let balanceChange = accountDataAfter.balance - accountDataBefore.balance
      if (balanceChange != null) {
        let totalBalance = blob.totalBalance + balanceChange
        if (totalBalance != null) {
          blob.totalBalance = totalBalance
        } else {
          if (statsDebugLogs)
            dapp.log(
              `error: null balance attempt. dataSummaryUpdate NodeAccount 1 ${accountDataAfter.balance} ${stringify(accountDataAfter.id)} ${accountDataBefore.balance} ${stringify(accountDataBefore.id)}`
            )
        }
      } else {
        if (statsDebugLogs)
          dapp.log(
            `error: null balance attempt. dataSummaryUpdate NodeAccount 2 ${accountDataAfter.balance} ${stringify(accountDataAfter.id)} ${accountDataBefore.balance} ${stringify(accountDataBefore.id)}`
          )
      }
    }
  },
  injectTxToConsensor(validatorDetails: any[], tx) {
    return utils.InjectTxToConsensor(validatorDetails, tx)
  },
  getNonceFromTx: function (tx: ShardusTypes.OpaqueTransaction): bigint {
    return BigInt(-1)
  },
  getAccountNonce: function (accountId: string, wrappedData?: ShardusTypes.WrappedData): Promise<bigint> {
    return new Promise(resolve => resolve(BigInt(-1)))
  },
  // todo: consider a base liberdus tx type
  getTxSenderAddress: function (tx: any): string {
    const result = {
      sourceKeys: [],
      targetKeys: [],
      allKeys: [],
      timestamp: tx.timestamp
    } as LiberdusTypes.TransactionKeys
    const keys = transactions[tx.type].keys(tx, result)
    return keys.allKeys[0]
  },
  isInternalTx: function (tx: LiberdusTypes.BaseLiberdusTx): boolean {
    // todo: decide what is internal and what is external
    const internalTxTypes = [
      TXTypes.init_network,
      TXTypes.issue,
      TXTypes.dev_issue,
      TXTypes.tally,
      TXTypes.apply_tally,
      TXTypes.dev_tally,
      TXTypes.apply_dev_tally,
      TXTypes.parameters,
      TXTypes.apply_parameters,
      TXTypes.dev_parameters,
      TXTypes.apply_dev_parameters,
      TXTypes.apply_change_config,
      TXTypes.apply_developer_payment,
      TXTypes.node_reward
    ]
    if (internalTxTypes.includes(tx.type)) {
      return true
    }
    return false
  },
  txPreCrackData: function (tx: ShardusTypes.OpaqueTransaction, appData: any): Promise<{ status: boolean; reason: string }> {
    return new Promise(resolve => resolve({status: true, reason: 'pass'}))
  },
  calculateTxId(tx: ShardusTypes.OpaqueTransaction) {
    return utils.generateTxId(tx)
  },
  getCachedRIAccountData: function (addressList: string[]): Promise<ShardusTypes.WrappedData[]> {
    console.log(`Not implemented getCachedRIAccountData`)
    return null
  },
  setCachedRIAccountData: function (accountRecords: unknown[]): Promise<void> {
    console.log(`Not implemented setCachedRIAccountData`)
    return null
  },
  async getNetworkAccount(): Promise<ShardusTypes.WrappedData> {
    const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
    return account
  },
  async isReadyToJoin(
    latestCycle: ShardusTypes.Cycle,
    publicKey: string,
    activeNodes: P2P.P2PTypes.Node[],
    mode: P2P.ModesTypes.Record['mode'] | null
  ): Promise<boolean> {
    return true
  },
  getJoinData() {
    const joinData = {
      version,
      stakeCert: '',
      adminCert: '',
      mustUseAdminCert: false,
    }
    return joinData
  },
  getNodeInfoAppData() {
    let minVersion = ''
    let activeVersion = ''
    let latestVersion = ''
    // const cachedNetworkAccount = AccountsStorage.cachedNetworkAccount
    // if (cachedNetworkAccount) {
    //   minVersion = cachedNetworkAccount.current.minVersion
    //   activeVersion = cachedNetworkAccount.current.activeVersion
    //   latestVersion = cachedNetworkAccount.current.latestVersion
    // }
    const shardeumNodeInfo: any = {
      // const shardeumNodeInfo: NodeInfoAppData = {
      liberdusVersion: version,
      minVersion,
      activeVersion,
      latestVersion,
      operatorCLIVersion: '',
      operatorGUIVersion: '',
    }
    return shardeumNodeInfo
  },
  canStayOnStandby(joinInfo: any): { canStay: boolean; reason: string } {
    return { canStay: true, reason: '' }
  },
  binarySerializeObject: null,
  binaryDeserializeObject: null,
  verifyMultiSigs: function (rawPayload: object, sigs: ShardusTypes.Sign[], allowedPubkeys: { [pubkey: string]: ShardusTypes.DevSecurityLevel }, minSigRequired: number, requiredSecurityLevel: ShardusTypes.DevSecurityLevel): boolean {
    return false
  },
  beforeStateAccountFilter(account: ShardusTypes.WrappedData) {
    return false
  },
})

dapp.registerExceptionHandler()

// CODE THAT GETS EXECUTED WHEN NODES START
;(async (): Promise<void> => {
  const cycleInterval = configs.cycleDuration * configs.ONE_SECOND

  let network: LiberdusTypes.NetworkAccount

  let issueGenerated = false
  let tallyGenerated = false
  let applyGenerated = false

  let devIssueGenerated = false
  let devTallyGenerated = false
  let devApplyGenerated = false

  let node: any
  let nodeId: string
  let nodeAddress: string
  let lastReward: number
  let cycleData: ShardusTypes.Cycle
  let currentTime: number
  let luckyNodes: string[]
  let expected = dapp.shardusGetTime() + cycleInterval
  let drift: number

  await dapp.start()

  // THIS CODE IS CALLED ON EVERY NODE ON EVERY CYCLE
  async function networkMaintenance(): Promise<NodeJS.Timeout> {
    dapp.log('New maintenance cycle has started')
    drift = dapp.shardusGetTime() - expected
    currentTime = dapp.shardusGetTime()

    try {
      const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
      network = account.data as LiberdusTypes.NetworkAccount
      ;[cycleData] = dapp.getLatestCycles()
      luckyNodes = dapp.getClosestNodes(cycleData.previous, LiberdusFlags.numberOfLuckyNodes)
      nodeId = dapp.getNodeId()
      node = dapp.getNode(nodeId)
      nodeAddress = node.address
    } catch (err) {
      dapp.log('ERR: ', err)
      console.log('ERR: ', err)
      return setTimeout(networkMaintenance, 100)
    }

    const driftFromCycleStart = (currentTime - cycleData.start * 1000) % cycleInterval
    dapp.log('driftFromCycleStart: ', driftFromCycleStart, currentTime, cycleData.start * 1000)
    dapp.log('payAddress: ', process.env.PAY_ADDRESS)
    dapp.log('cycleData: ', cycleData)
    dapp.log('luckyNode: ', luckyNodes)
    dapp.log('nodeId: ', nodeId)
    dapp.log('nodeAddress: ', nodeAddress)
    dapp.log('windows: ', network.windows)
    dapp.log('nextWindows: ', network.nextWindows)
    dapp.log('devWindows: ', network.devWindows)
    dapp.log('nextDevWindows: ', network.nextDevWindows)
    dapp.log('current: ', network.current)
    dapp.log('next: ', network.next)
    dapp.log('developerFund: ', network.developerFund)
    dapp.log('nextDeveloperFund: ', network.nextDeveloperFund)
    dapp.log('issue: ', network.issue)
    dapp.log('devIssue: ', network.devIssue)

    const isProcessingMode = cycleData.mode === 'processing'
    if (network.windows == null) {
      if (isProcessingMode && luckyNodes.includes(nodeId)) {
        // start network DAO time windows
        dapp.log('Starting network windows', luckyNodes, nodeId)
        await utils.startNetworkWindows(nodeAddress, nodeId, dapp)
        nestedCountersInstance.countEvent('liberdus', 'start_network_windows')
      }

      expected += cycleInterval
      let nextMaintenanceWait = Math.max(0, cycleInterval - drift)
      if (nextMaintenanceWait <= 0) nextMaintenanceWait = cycleInterval
      let nextMaintenanceCycleStart = nextMaintenanceWait - driftFromCycleStart
      dapp.log(`Maintenance cycle has ended. Next maintenance in ${nextMaintenanceCycleStart} ms`)
      return setTimeout(networkMaintenance, nextMaintenanceCycleStart)
    }

    // reset the DAO windows if it has been too long
    if (currentTime > network.windows.proposalWindow[0] && currentTime - network.windows.proposalWindow[0] > TOTAL_DAO_DURATION * 3) {
      if (isProcessingMode && luckyNodes.includes(nodeId)) {
        dapp.log('Resetting network windows', luckyNodes, nodeId)
        await utils.startNetworkWindows(nodeAddress, nodeId, dapp)
        nestedCountersInstance.countEvent('liberdus', 'reset_network_windows')
      }

      expected += cycleInterval
      let nextMaintenanceWait = Math.max(0, cycleInterval - drift)
      if (nextMaintenanceWait <= 0) nextMaintenanceWait = cycleInterval
      let nextMaintenanceCycleStart = nextMaintenanceWait - driftFromCycleStart
      dapp.log(`Maintenance cycle has ended. Next maintenance in ${nextMaintenanceCycleStart} ms`)
      return setTimeout(networkMaintenance, nextMaintenanceCycleStart)
    }

    const isInProposalWindow = currentTime >= network.windows.proposalWindow[0] && currentTime <= network.windows.proposalWindow[1]
    const isInDevProposalWindow = currentTime >= network.devWindows.devProposalWindow[0] && currentTime <= network.devWindows.devProposalWindow[1]

    const isInGraceWindow = currentTime >= network.windows.graceWindow[0] && currentTime <= network.windows.graceWindow[1]
    const isInDevGraceWindow = currentTime >= network.devWindows.devGraceWindow[0] && currentTime <= network.devWindows.devGraceWindow[1]

    const isInApplyWindow = currentTime >= network.windows.applyWindow[0] && currentTime <= network.windows.applyWindow[1]
    const isInDevApplyWindow = currentTime >= network.devWindows.devApplyWindow[0] && currentTime <= network.devWindows.devApplyWindow[1]
    const skipConsensus =  cycleData.active === 1

    dapp.log(`Cycle: ${cycleData.counter}, isInProposalWindow: ${isInProposalWindow}, isInDevProposalWindow: ${isInDevProposalWindow}, isInGraceWindow: ${isInGraceWindow}, isInDevGraceWindow: ${isInDevGraceWindow}, isInApplyWindow: ${isInApplyWindow}, isProcessingMode: ${isProcessingMode}`)

    if (isProcessingMode === false || luckyNodes.includes(nodeId) === false) {
      expected += cycleInterval
      let nextMaintenanceWait = Math.max(0, cycleInterval - drift)
      if (nextMaintenanceWait <= 0) nextMaintenanceWait = cycleInterval
      let nextMaintenanceCycleStart = nextMaintenanceWait - driftFromCycleStart
      dapp.log(`Maintenance cycle has ended. We are not lucky nodes. Next maintenance in ${nextMaintenanceCycleStart} ms`)
      return setTimeout(networkMaintenance, nextMaintenanceCycleStart)
    }

    // from this point, we are lucky node and in processing mode
    const issueAccountId =  utils.calculateIssueId(network.issue)
    const issueAccount = await dapp.getLocalOrRemoteAccount(issueAccountId)

    const devIssueAccountId =  utils.calculateDevIssueId(network.devIssue)
    const devIssueAccount = await dapp.getLocalOrRemoteAccount(devIssueAccountId)

    dapp.log('latest issueAccount: ', issueAccountId, issueAccount?.data)
    dapp.log('latest devIssueAccount: ', devIssueAccountId, devIssueAccount?.data)

    // ISSUE: create a new issue so that people can submit proposals/votes
    if (isInProposalWindow) {
      if (issueAccount == null) {
        dapp.log(`issueAccount is null, we need to submit a new issue for issue: ${network.issue}`)
        await utils.generateIssue(nodeAddress, nodeId, dapp, skipConsensus)
        issueGenerated = true
        tallyGenerated = false
        applyGenerated = false
      }
    }

    // DEV_ISSUE: create new funding issue so that developers can request funds/votes
    if (isInDevProposalWindow) {
      if (devIssueAccount == null) {
        dapp.log(`devIssueAccount is null, we need to submit a new dev issue for devIssue: ${network.devIssue}`)
        await utils._sleep(3000) // this is to wait a moment for above issue tx to be processed
        await utils.generateDevIssue(nodeAddress, nodeId, dapp, skipConsensus)
        devIssueGenerated = true
        devTallyGenerated = false
        devApplyGenerated = false
      }
    }

    // TALLY: count the votes for the proposals (network params)
    // todo: we may not want to tally as soon as the grace window starts
    if (isInGraceWindow) {
      // @ts-ignore
      const issueWinner = issueAccount?.data?.winnerId
      if (issueWinner == null) {
        dapp.log(`issueWinner is null, we need to tally the votes for issue: ${network.issue}`)
        await utils.tallyVotes(nodeAddress, nodeId, dapp, skipConsensus)
        issueGenerated = false
        tallyGenerated = true
        applyGenerated = false
      }
    }

    // DEV_TALLY: count the votes for the dev proposals (developer fund)
    if (isInDevGraceWindow) {
      // @ts-ignore
      const devIssueWinners = devIssueAccount?.data?.winners
      if (devIssueWinners == null || devIssueWinners.length === 0) {
        dapp.log(`devIssueWinners is null, we need to tally the votes for devIssue: ${network.devIssue}`)
        await utils._sleep(3000) // this is to wait a moment for above tally tx to be processed
        await utils.tallyDevVotes(nodeAddress, nodeId, dapp, skipConsensus)
        devIssueGenerated = false
        devTallyGenerated = true
        devApplyGenerated = false
      }
    }

    // PARAMETER tx should initiate apply_parameters tx (i.e. apply the winning network parameters)
    if (isInApplyWindow) {
      // @ts-ignore
      const isIssueActive = issueAccount?.data?.active
      if (isIssueActive) { // still active means it has not been applied the parameters
        dapp.log(`issueAccount is still active in applyWindows, we need to apply the parameters for issue: ${network.issue}`)
        await utils.injectParameterTx(nodeAddress, nodeId, dapp, skipConsensus)
        issueGenerated = false
        tallyGenerated = false
        applyGenerated = true
      }
    }

    // DEV_PARAMETER tx should initiate apply_dev_parameters tx (i.e. apply the winning fundings)
    if (isInDevApplyWindow) {
      // @ts-ignore
      const isDevIssueActive = devIssueAccount?.data?.active
      if (isDevIssueActive) { // still active means it has not been applied the dev parameters
        dapp.log(`devIssueAccount is still active in devApplyWindows, we need to apply the dev parameters for devIssue: ${network.devIssue}`)
        await utils._sleep(3000) // this is to wait a moment for above parameter tx to be processed
        await utils.injectDevParameters(nodeAddress, nodeId, dapp, skipConsensus)
        devIssueGenerated = false
        devTallyGenerated = false
        devApplyGenerated = true
      }
    }

    if (isProcessingMode) {
      // LOOP THROUGH IN-MEMORY DEVELOPER_FUND
      for (const payment of network.developerFund) {
        // PAY DEVELOPER IF THE network.current TIME IS GREATER THAN THE PAYMENT TIME
        if (currentTime >= payment.timestamp) {
          if (luckyNodes.includes(nodeId)) {
            utils.releaseDeveloperFunds(payment, nodeAddress, nodeId, dapp)
          }
        }
      }
    }

    dapp.log('issueGenerated: ', issueGenerated)
    dapp.log('tallyGenerated: ', tallyGenerated)
    dapp.log('applyGenerated: ', applyGenerated)

    dapp.log('devIssueGenerated: ', devIssueGenerated)
    dapp.log('devTallyGenerated: ', devTallyGenerated)
    dapp.log('devApplyGenerated: ', devApplyGenerated)

    expected += cycleInterval
    let nextMaintenanceWait = Math.max(0, cycleInterval - drift)
    if (nextMaintenanceWait <= 0) nextMaintenanceWait = cycleInterval
    let nextMaintenanceCycleStart = nextMaintenanceWait - driftFromCycleStart
    dapp.log(`Maintenance cycle has ended. Next maintenance in ${nextMaintenanceCycleStart} ms`)
    return setTimeout(networkMaintenance, nextMaintenanceCycleStart)
  }

  dapp.on(
    'active',
    async (): Promise<NodeJS.Timeout> => {
      if (dapp.p2p.isFirstSeed) {
        await utils._sleep(configs.ONE_SECOND * configs.cycleDuration * 2)
      }
      const currentTime = dapp.shardusGetTime()
      let currentCycle: ShardusTypes.Cycle
      ;[currentCycle] = dapp.getLatestCycles()
      let currentCycleStartMs = currentCycle.start * 1000
      let waitTime = 0
      if (currentTime < currentCycleStartMs + cycleInterval) {
        // wait till this cycle end
        waitTime = currentCycleStartMs + cycleInterval - currentTime
      } else {
        // or wait till next cycle end
        waitTime = currentCycleStartMs + 2*cycleInterval - currentTime
      }
      lastReward = dapp.shardusGetTime()
      return setTimeout(networkMaintenance, waitTime)
    },
  )
})()
