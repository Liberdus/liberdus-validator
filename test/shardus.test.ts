import execa from 'execa'
import { resolve } from 'path'
import * as crypto from 'shardus-crypto-utils'
import fs from 'fs'
import axios from 'axios'
import * as utils from './testUtils'
import { util } from 'prettier'
import { spawn, exec } from 'child_process'

crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

const USE_EXISTING_NETWORK = false
const START_NETWORK_SIZE = 5
let accounts = []
const network = '0'.repeat(64)


test('Start a new network successfully', async () => {
  console.log(utils.infoGreen('TEST: Start a new network successfully'))
  if (USE_EXISTING_NETWORK) {
    console.log(utils.info('Using existing active network'))
    let activeNodes = await utils.queryActiveNodes()
    expect(Object.keys(activeNodes).length).toBe(START_NETWORK_SIZE)
  } else {
    try {
      execa.commandSync('shardus stop', { stdio: [0, 1, 2] })
      await utils._sleep(3000)
      execa.commandSync('rm -rf instances')
    } catch (e) {
      console.log('Unable to remove instances folder')
    }
    execa.commandSync(`shardus create --no-log-rotation  ${START_NETWORK_SIZE * 2}`, { stdio: [0, 1, 2] }) // start 2 times of minNode
    const isNetworkActive = await utils.waitForNetworkToBeActive(START_NETWORK_SIZE)
    expect(isNetworkActive).toBe(true)
  }
})

test('Process txs at the rate of 5 txs per node/per second for 1 min', async () => {
  console.log(utils.infoGreen('TEST: Process txs at the rate of 5 txs per node/per second for 1 min'))

  const activeNodes = await utils.queryActiveNodes()
  const nodeCount = Object.keys(activeNodes).length
  const durationMinute = 1
  const durationSecond = 60 * durationMinute
  const durationMiliSecond = 1000 * durationSecond

  await utils.resetReport()
  await utils._sleep(10000) // need to wait monitor-server to collect active nodes after reset

  let spamCommand = `spammer spam -t create -d ${durationSecond} -r ${nodeCount * 5} -a ${nodeCount * 50} -m http://localhost:3000/api/report`
  console.log(utils.info('Spamming the network...', spamCommand))
  execa.command(spamCommand).stdout.pipe(process.stdout)
  await utils._sleep(durationMiliSecond + 10000) // extra 10s for processing pending txs in the queue

  let report = await utils.queryLatestReport()
  let processedRatio = report.totalProcessed / report.totalInjected

  // TBC: process / injected ratio should be 80% or more
  expect(processedRatio).toBeGreaterThanOrEqual(0.8)
  // TBC: rejected should be less than 3% of total injected 
  expect(report.totalRejected).toBeLessThanOrEqual(report.totalInjected * 0.03)
})

test('Auto scale up the network successfully', async () => {
  console.log(utils.infoGreen('TEST: Auto scale up the network successfully'))
  let spamCommand = `spammer spam -t create -d 3600 -r ${START_NETWORK_SIZE * 6} -a ${START_NETWORK_SIZE * 60} -q 10 -m http://localhost:3000/api/report`
  let spamProcess = execa.command(spamCommand)
  let isLoadIncreased = await utils.waitForNetworkLoad('high', 0.2)

  console.log(utils.info('Waiting for network to scale up...'))

  let hasNetworkScaledUp = await utils.waitForNetworkScaling(START_NETWORK_SIZE * 2)
  spamProcess.cancel()

  expect(isLoadIncreased).toBe(true)
  expect(hasNetworkScaledUp).toBe(true)
})

test('Auto scale down the network successfully', async () => {
  console.log(utils.infoGreen('TEST: Auto scale down the network successfully'))
  console.log(utils.info('Waiting for network to scale down...'))

  let isLoadDecreased = await utils.waitForNetworkLoad('low', 0.2)
  let hasNetworkScaledDown = await utils.waitForNetworkScaling(START_NETWORK_SIZE)

  expect(hasNetworkScaledDown).toBe(true)
  expect(isLoadDecreased).toBe(true)
})

test('Data is correctly synced across the nodes after network scaled down', async () => {
  console.log(utils.infoGreen('TEST: Data is correctly synced across the nodes after network scaled down'))
  let result = await utils.getInsyncAll()
  const in_sync = result.in_sync === START_NETWORK_SIZE
  const out_sync = result.out_sync === 0
  expect(in_sync).toBe(true)
  expect(out_sync).toBe(true)
})

test('Start new archivers successfully', async () => {
  console.log(utils.infoGreen('TEST: Start new archivers successfully'))

  try {
    execa.commandSync('shardus start --archivers 1')
  } catch (e) {
    console.log(utils.warning(e))
  }
  let hasNewArchiverJoined = await utils.waitForArchiverToJoin('localhost', 4001)

  expect(hasNewArchiverJoined).toBe(true)
})

test('New archivers sync archived data successfully', async () => {
  console.log(utils.infoGreen('TEST: New archivers sync archived data successfully'))
  await utils._sleep(60000) // needs to wait while new archiver is syncing data

  const dataFromArchiver_1 = await utils.queryArchivedCycles('localhost', 4000, 10)
  const dataFromArchiver_2 = await utils.queryArchivedCycles('localhost', 4001, 10)
  let hasSameData = true
  for (let i=0; i < dataFromArchiver_1.length; i++) {
    let data1 = dataFromArchiver_1[i]
    let data2 = dataFromArchiver_2[i]
    // TODO: need to neglect "count" field from archivedCycle['summary']['partitionBlobs']
    let isSame = JSON.stringify(data1) === JSON.stringify(data2)
    if (!isSame) {
      hasSameData = utils.deepObjCheck(data1, data2, 'counter') // deep object checking where it neglects 'counter' field
      break
    }
  }
  expect(hasSameData).toBe(true)
})

test('Archivers store complete historical data without missing cycles', async () => {
  console.log(utils.infoGreen('TEST: Archivers store complete historical data without missing cycles'))

  const dataFromArchiver_1 = await utils.queryArchivedCycles('localhost', 4000, 5)
  const dataFromArchiver_2 = await utils.queryArchivedCycles('localhost', 4001, 5)
  const latestRecord = await utils.queryLatestCycleRecordFromConsensor()

  const countersFromData1 = dataFromArchiver_1.map(a => a.cycleRecord.counter)
  const countersFromData2 = dataFromArchiver_2.map(a => a.cycleRecord.counter)

  expect(countersFromData1[0]).toBe(latestRecord.counter)
  expect(countersFromData2[0]).toBe(latestRecord.counter)

  expect(utils.isDecreasingSequence(countersFromData1)).toBe(true)
  expect(utils.isDecreasingSequence(countersFromData2)).toBe(true)
})

test('Check receipt of a transfer tx between 2 accounts', async () => {
  console.log(utils.infoGreen('TEST: Check receipt of a transfer tx'))

  const alias1 = 'tester' + Math.floor(Math.random() * 1000)
  const alias2 = 'tester' + Math.floor(Math.random() * 1000)

  const account1 = utils.createEntry(alias1, null)
  const account2 = utils.createEntry(alias2, null)

  await utils.injectTx(
    {
      type: 'register',
      aliasHash: crypto.hash(alias1),
      from: account1.address,
      alias: alias1,
      timestamp: Date.now(),
    },
    account1,
  )

  await utils.injectTx(
    {
      type: 'register',
      aliasHash: crypto.hash(alias2),
      from: account2.address,
      alias: alias2,
      timestamp: Date.now(),
    },
    account2,
  )

  await utils._sleep(8000)
  const seedNodes = await utils.getSeedNodes();
  const target = seedNodes[Math.floor(Math.random() * seedNodes.length)].port
  let res = await axios.get(`http://localhost:${target}/address/${crypto.hash(alias1)}`)
  expect(res.data.address).toBe(account1.address)
  res = await axios.get(`http://localhost:${target}/address/${crypto.hash(alias2)}`)
  expect(res.data.address).toBe(account2.address)

  await utils.injectTx(
    {
      type: 'transfer',
      from: account1.address,
      to: account2.address,
      amount: 1,
      timestamp: Date.now(),
    },
    account1,
  )

  await utils._sleep(10000)
  const result = await axios.get(`http://localhost:${target}/account/${account1.address}`)
  const accountData1 = result.data.account
  const txs = accountData1.data.transactions
  expect(txs.length).toBe(1)

  await utils._sleep(90000) // wait 3 cycles to make sure archiver and explorer have archived data 

  const transferTx = txs[0]
  res = await axios.post(`http://localhost:4444/api/tx/status`, {
    address: transferTx.from,
    timestamp: transferTx.timestamp,
    txid: transferTx.txId
  })
  expect(res.data.success).toBe(true)
})


test('Stops a network successfully', async () => {
  console.log(utils.infoGreen('TEST: Stops a network successfully'))
  execa.commandSync('shardus stop', { stdio: [0, 1, 2] })
  await utils._sleep(3000)
  expect(true).toBe(true)
})

test('Recover stopped network without losing old data', async () => {
  console.log(utils.infoGreen('TEST: Recover stopped network without losing old data'))

  execa.commandSync('shardus start', { stdio: [0, 1, 2] })
  let isDataRecovered = await utils.waitForNetworkToBeActive(START_NETWORK_SIZE)
  if (isDataRecovered) {
    for (let i = 0; i < Math.min(accounts.length, 10); i++) {
      let account = accounts[i]
      let recoveredAccount = await utils.queryAccountById(account.id)
      if (!recoveredAccount) {
        console.log(`Account: ${account.id} is not found in recovered network`)
        isDataRecovered = false
        break
      }
    }
  }
  expect(isDataRecovered).toBe(true)
})

test('Cleans a network successfully', async () => {
  execa.commandSync('shardus stop', { stdio: [0, 1, 2] })
  await utils._sleep(3000)
  execa.commandSync('shardus clean', { stdio: [0, 1, 2] })
  await utils._sleep(2000)
  execa.commandSync('rm -rf instances')
  expect(true).toBe(true)
})
