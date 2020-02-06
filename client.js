const fs = require('fs')
const { resolve } = require('path')
const path = require('path')
const vorpal = require('vorpal')()
const crypto = require('shardus-crypto-utils')
const stringify = require('fast-stable-stringify')
const axios = require('axios')
crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

// BEFORE TESTING LOCALLY, CHANGE THE ADMIN_ADDRESS IN LIBERDUS-SERVER TO ONE YOU HAVE LOCALLY
let USER
let HOST = process.argv[2] || 'localhost:9001'
let ARCHIVESERVER = process.argv[3] || 'localhost:4000'
console.log(`Using ${HOST} as node for queries and transactions.`)

// USEFUL CONSTANTS FOR TIME IN MILLISECONDS
const ONE_SECOND = 1000
const ONE_MINUTE = 60 * ONE_SECOND
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
const ONE_WEEK = 7 * ONE_DAY
const ONE_YEAR = 365 * ONE_DAY

const walletFile = resolve('./wallet.json')
let walletEntries = {}

const baseDir = '.'

try {
  walletEntries = require(walletFile)
} catch (e) {
  saveEntries(walletEntries, walletFile)
  console.log(`Created wallet file '${walletFile}'.`)
}

console.log(`Loaded wallet entries from '${walletFile}'.`)

async function getSeedNodes () {
  let result = await axios.get(`http://${ARCHIVESERVER}/nodelist`) // await utils.getJson(`${glob.seedNode}/nodelist`)

  let seedNodes = []
  let nodelist = result.data.nodeList
  if (nodelist !== null) {
    // Filter out all non-active nodes. dont filter yet no one will say active.
    // nodelist = nodelist.filter(node => node.status ? node.status === 'active' : false)
    seedNodes = nodelist
  }
  return seedNodes
}

function saveEntries (entries, file) {
  const stringifiedEntries = JSON.stringify(entries, null, 2)
  fs.writeFileSync(file, stringifiedEntries)
}

function createAccount (keys = crypto.generateKeypair()) {
  return {
    address: keys.publicKey,
    keys
  }
}

function createAccounts (num) {
  const accounts = new Array(num).fill().map(account => createAccount())
  return accounts
}

// Creates an account with a keypair and adds it to the clients walletFile
function createEntry (name, id) {
  const account = createAccount()
  if (typeof id === 'undefined' || id === null) {
    id = crypto.hash(name)
  }
  account.id = id
  walletEntries[name] = account
  saveEntries(walletEntries, walletFile)
  return account
}

function makeTxGenerator (accounts, total = 0, type) {
  function * buildGenerator (txBuilder, accounts, total, type) {
    let account1, offset, account2
    // let username
    // let users = {}
    while (total > 0) {
      // Keep looping through all available accounts as the srcAcct
      account1 = accounts[total % accounts.length]
      // Pick some other random account as the tgtAcct
      offset = Math.floor(Math.random() * (accounts.length - 1)) + 1
      account2 = accounts[(total + offset) % accounts.length]

      // if (!users[account1.address]) {
      //   username = `user${account1.address.slice(0, 4)}`
      //   yield txBuilder({
      //     type: 'register',
      //     from: account1,
      //     handle: username,
      //     id: crypto.hash(username)
      //   })
      //   total--
      //   users[account1.address] = true
      // }

      // Return a create tx to add funds to the srcAcct
      yield txBuilder({ type: 'create', to: account1, amount: 1 })
      total--
      if (!(total > 0)) break

      // Return a transfer tx to transfer funds from srcAcct to tgtAcct
      switch (type) {
        case 'create': {
          yield txBuilder({ type: 'create', to: account1, amount: 1 })
          break
        }
        case 'transfer': {
          yield txBuilder({
            type: 'transfer',
            from: account1,
            to: account2,
            amount: 1
          })
          break
        }
        case 'friend': {
          yield txBuilder({
            type: 'friend',
            from: account1,
            to: account2,
            amount: 1
          })
          break
        }
        case 'message': {
          const message = stringify({
            body: 'spam1234',
            timestamp: Date.now(),
            handle: account1.address.slice(0, 5)
          })
          yield txBuilder({
            type: 'message',
            from: account1,
            to: account2,
            message: message,
            amount: 1
          })
          break
        }
        case 'toll': {
          yield txBuilder({
            type: 'toll',
            from: account1,
            toll: Math.ceil(Math.random() * 1000),
            amount: 1
          })
          break
        }
        default: {
          console.log('Type must be `transfer`, `message`, or `toll`')
        }
      }
      total--
      if (!(total > 0)) break
    }
  }
  const generator = buildGenerator(buildTx, accounts, total, type)
  generator.length = total
  return generator
}

function buildTx ({ type, from = {}, to, handle, id, amount, message, toll }) {
  let actualTx
  switch (type) {
    case 'register': {
      actualTx = {
        type,
        from: from.address,
        handle,
        id,
        timestamp: Date.now()
      }
      break
    }
    case 'create': {
      actualTx = {
        type,
        from: '0'.repeat(64),
        to: to.address,
        amount: Number(amount),
        timestamp: Date.now()
      }
      break
    }
    case 'transfer': {
      actualTx = {
        type,
        from: from.address,
        timestamp: Date.now(),
        to: to.address,
        amount: Number(amount)
      }
      break
    }
    case 'friend': {
      actualTx = {
        type,
        from: from.address,
        to: to.address,
        handle: `${to.address.slice(0, 5)}`,
        amount: Number(amount),
        timestamp: Date.now()
      }
      break
    }
    case 'message': {
      actualTx = {
        type,
        from: from.address,
        to: to.address,
        message: message,
        amount: Number(amount),
        timestamp: Date.now()
      }
      break
    }
    case 'toll': {
      actualTx = {
        type,
        from: from.address,
        toll,
        amount: Number(amount),
        timestamp: Date.now()
      }
      break
    }
    default: {
      console.log('Type must be `transfer`, `message`, or `toll`')
    }
  }
  if (from.keys) {
    crypto.signObj(actualTx, from.keys.secretKey, from.keys.publicKey)
  } else {
    crypto.signObj(actualTx, to.keys.secretKey, to.keys.publicKey)
  }
  return actualTx
}

let logError = false

async function sendTx (tx, node = null, verbose = false) {
  if (!tx.sign) {
    tx = buildTx(tx)
  }
  // if (verbose) {
  //   console.log(`Sending tx to ${node}...`)
  //   console.log(tx)
  // }
  try {
    let target = HOST
    if (node != null) {
      target = node
    }
    const { data } = await axios.post(`http://${target}/inject`, tx)
    if (verbose) console.log('Got response:', data)
    return data
  } catch (err) {
    if (logError) console.log('Stopped spamming due to error')
  }
}

async function spamTxs ({
  txs,
  rate,
  nodes = [],
  saveFile = null
}) {
  if (!Array.isArray(nodes)) nodes = [nodes]

  console.log(
    `Spamming ${nodes.length > 1 ? 'nodes' : 'node'} ${nodes.join()} with ${
      txs.length ? txs.length + ' ' : ''
    }txs at ${rate} TPS...`
  )

  const writeStream = saveFile
    ? fs.createWriteStream(path.join(baseDir, saveFile))
    : null

  const promises = []
  let node

  for (const tx of txs) {
    if (writeStream) writeStream.write(JSON.stringify(tx, null, 2) + '\n')
    node = nodes[Math.floor(Math.random() * nodes.length)]
    promises.push(sendTx(tx, node))
    await _sleep((1 / rate) * 1000)
  }
  if (writeStream) writeStream.end()
  console.log()

  await Promise.all(promises)
  console.log('Done spamming')

  if (writeStream) {
    await new Promise(resolve => writeStream.on('finish', resolve))
    console.log(`Wrote spammed txs to '${saveFile}'`)
  }
}

async function _sleep (ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function injectTx (tx) {
  try {
    const res = await axios.post(`http://${HOST}/inject`, tx)
    return res.data
  } catch (err) {
    return err.message
  }
}

async function takeSnapshot (host) {
  try {
    const res = await axios.get(`http://${host || HOST}/debug/dump`)
    return res.data
  } catch (err) {
    return err
  }
}

async function getAccountData (id) {
  try {
    const res = await axios.get(`http://${HOST}/${id ? 'account/' + id : 'accounts'}`)
    return res.data
  } catch (err) {
    return err.message
  }
}

async function getToll (friendId, yourId) {
  try {
    let res = await axios.get(`http://${HOST}/account/${friendId}/${yourId}/toll`)
    if (res.data.toll) {
      return { toll: res.data.toll }
    }
  } catch (error) {
    return { error: error }
  }
}

async function getAddress (handle) {
  if (handle.length === 64) return handle
  try {
    let res = await axios.get(`http://${HOST}/address/${crypto.hash(handle)}`)
    const { address, error } = res.data
    if (error) {
      console.log(error)
    } else {
      return address
    }
  } catch (error) {
    console.log(error)
  }
}

async function queryMessages (to, from) {
  try {
    const res = await axios.get(`http://${HOST}/messages/${crypto.hash([from, to].sort((a, b) => a < b).join(''))}`)
    const { messages } = res.data
    return messages
  } catch (error) {
    return error
  }
}

// QUERY'S THE TRANSACTIONS OF THE CURRENT WALLET
async function queryTransactions () {
  try {
    const res = await axios.get(`http://${HOST}/account/${USER.address}/transactions`)
    const { transactions } = res.data
    return transactions
  } catch (error) {
    return error
  }
}

// QUERY'S THE CURRENT NETWORK PARAMETERS
async function queryParameters () {
  const res = await axios.get(`http://${HOST}/network/parameters`)
  if (res.data.error) {
    return res.data.error
  } else {
    return res.data.parameters
  }
}

// QUERY'S THE CURRENT PHASE OF THE DYNAMIC PARAMETER SYSTEM
async function queryWindow () {
  const res = await axios.get(`http://${HOST}/network/windows/all`)
  if (res.data.error) {
    return res.data.error
  } else {
    let { windows, devWindows } = res.data
    let timestamp = Date.now()
    let windowTime, devWindowTime
    if (inRange(timestamp, windows.proposalWindow)) windowTime = { proposals: Math.round((windows.proposalWindow[1] - timestamp) / 1000) }
    else if (inRange(timestamp, windows.votingWindow)) windowTime = { voting: Math.round((windows.votingWindow[1] - timestamp) / 1000) }
    else if (inRange(timestamp, windows.graceWindow)) windowTime = { grace: Math.round((windows.graceWindow[1] - timestamp) / 1000) }
    else if (inRange(timestamp, windows.applyWindow)) windowTime = { apply: Math.round((windows.applyWindow[1] - timestamp) / 1000) }
    else windowTime = { apply: Math.round((windows.proposalWindow[0] - timestamp) / 1000) }

    if (inRange(timestamp, devWindows.devProposalWindow)) devWindowTime = { devProposals: Math.round((devWindows.devProposalWindow[1] - timestamp) / 1000) }
    else if (inRange(timestamp, devWindows.devVotingWindow)) devWindowTime = { devVoting: Math.round((devWindows.devVotingWindow[1] - timestamp) / 1000) }
    else if (inRange(timestamp, devWindows.devGraceWindow)) devWindowTime = { devGrace: Math.round((devWindows.devGraceWindow[1] - timestamp) / 1000) }
    else if (inRange(timestamp, devWindows.devApplyWindow)) devWindowTime = { devApply: Math.round((devWindows.devApplyWindow[1] - timestamp) / 1000) }
    else devWindowTime = { devApply: Math.round((devWindows.devProposalWindow[0] - timestamp) / 1000) }
    return { window: windowTime, devWindow: devWindowTime }
  }
  function inRange (now, times) {
    return now > times[0] && now < times[1]
  }
}

// QUERY'S THE CURRENT NETWORK PARAMETERS ON HOST NODE (TESTING)
async function queryNodeParameters () {
  const res = await axios.get(`http://${HOST}/network/parameters/node`)
  if (res.data.error) {
    return res.data.error
  } else {
    return res.data.parameters
  }
}

// QUERY'S ALL NETWORK ISSUES
async function queryIssues () {
  const res = await axios.get(`http://${HOST}/issues`)
  return res.data.issues
}

// QUERY'S ALL NETWORK DEV_ISSUES
async function queryDevIssues () {
  const res = await axios.get(`http://${HOST}/issues/dev`)
  return res.data.devIssues
}

// QUERY'S THE MOST RECENT NETWORK ISSUE
async function queryLatestIssue () {
  const res = await axios.get(`http://${HOST}/issues/latest`)
  return res.data.issue
}

// QUERY'S THE MOST RECENT NETWORK DEV_ISSUE
async function queryLatestDevIssue () {
  const res = await axios.get(`http://${HOST}/issues/dev/latest`)
  return res.data.devIssue
}

// QUERY'S THE CURRENT NETWORK ISSUE COUNT
async function getIssueCount () {
  const res = await axios.get(`http://${HOST}/issues/count`)
  return res.data.count
}

// QUERY'S THE CURRENT NETWORK DEV_ISSUE COUNT
async function getDevIssueCount () {
  const res = await axios.get(`http://${HOST}/issues/dev/count`)
  return res.data.count
}

// QUERY'S ALL NETWORK PROPOSALS
async function queryProposals () {
  const res = await axios.get(`http://${HOST}/proposals`)
  return res.data.proposals
}

// QUERY'S ALL NETWORK DEV_PROPOSALS
async function queryDevProposals () {
  const res = await axios.get(`http://${HOST}/proposals/dev`)
  return res.data.devProposals
}

// QUERY'S ALL PROPOSALS ON THE LATEST ISSUE
async function queryLatestProposals () {
  const res = await axios.get(`http://${HOST}/proposals/latest`)
  return res.data.proposals
}

// QUERY'S ALL PROPOSALS ON THE LATEST ISSUE
async function queryLatestDevProposals () {
  const res = await axios.get(`http://${HOST}/proposals/dev/latest`)
  return res.data.devProposals
}

// QUERY'S THE CURRENT ISSUE'S PROPOSAL COUNT
async function getProposalCount () {
  const res = await axios.get(`http://${HOST}/proposals/count`)
  return res.data.count
}

// QUERY'S THE CURRENT ISSUE'S PROPOSAL COUNT
async function getDevProposalCount () {
  const res = await axios.get(`http://${HOST}/proposals/dev/count`)
  return res.data.count
}

// COMMAND TO SET THE HOST IP:PORT
vorpal.command('use host <host>', 'uses <host> as the node for queries and transactions')
  .action(function (args, callback) {
    HOST = args.host
    this.log(`Set ${args.host} as coin-app node for transactions.`)
    callback()
  })

// COMMAND TO SUBMIT A SNAPSHOT OF THE ULT CONTRACT (ADMIN ONLY)
vorpal.command('snapshot', 'submits the snapshot the ULT contract')
  .action(function (_, callback) {
    const snapshot = require(resolve('snapshot.json'))
    this.log(snapshot)
    const tx = {
      type: 'snapshot',
      from: USER.address,
      to: '0'.repeat(64),
      snapshot,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

vorpal.command('email', 'registers your email address to the network')
  .action(async function (_, callback) {
    const answer = await this.prompt({
      type: 'input',
      name: 'email',
      message: 'Enter your email address: ',
      validate: result => {
        const regex = /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/
        if (!regex.test(result)) {
          return 'You need to provide a valid email address'
        } else {
          return true
        }
      }
    })
    const signedTx = {
      emailHash: crypto.hash(answer.email),
      from: USER.address
    }
    crypto.signObj(signedTx, USER.keys.secretKey, USER.keys.publicKey)
    const tx = {
      type: 'email',
      signedTx,
      email: answer.email,
      timestamp: Date.now()
    }
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

vorpal.command('verify', 'verifies your email address')
  .action(async function (_, callback) {
    const answer = await this.prompt({
      type: 'input',
      name: 'code',
      message: 'Enter the verification code sent to your email address: ',
      validate: result => {
        result = result.split` `.join``
        if (typeof result === 'string' && result.length === 6) {
          return true
        } else {
          return 'You need to provide the 6 digit code'
        }
      }
    })
    const tx = {
      type: 'verify',
      from: USER.address,
      code: answer.code,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO REGISTER AN ALIAS FOR A USER ACCOUNT
vorpal.command('register', 'registers a unique alias for your account')
  .action(async function (args, callback) {
    const answer = await this.prompt({
      type: 'input',
      name: 'alias',
      message: 'Enter the alias you want: '
    })
    const tx = {
      type: 'register',
      aliasHash: crypto.hash(answer.alias),
      from: USER.address,
      alias: answer.alias,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO CREATE TOKENS FOR A USER ACCOUNT ON THE NETWORK (TEST ONLY)
vorpal.command('create', 'creates tokens for an account')
  .action(async function (args, callback) {
    const answers = await this.prompt([{
      type: 'input',
      name: 'target',
      message: 'Enter the target account: '
    },
    {
      type: 'number',
      name: 'amount',
      message: 'Enter number of tokens to create: ',
      default: 500,
      filter: value => parseInt(value)
    }])
    const to = await getAddress(answers.target)
    if (!to) {
      this.log('Target account address does not exist')
      callback()
    } else {
      const tx = {
        type: 'create',
        from: '0'.repeat(64),
        to: to,
        amount: answers.amount,
        timestamp: Date.now()
      }
      injectTx(tx).then(res => {
        this.log(res)
        callback()
      })
    }
  })

// COMMAND TO TRANSFER TOKENS FROM ONE ACCOUNT TO ANOTHER
vorpal.command('transfer', 'transfers tokens to another account')
  .action(async function (_, callback) {
    const answers = await this.prompt([{
      type: 'input',
      name: 'target',
      message: 'Enter the target account: '
    },
    {
      type: 'number',
      name: 'amount',
      message: 'How many tokens do you want to send: ',
      default: 50,
      filter: value => parseInt(value)
    }])
    const to = await getAddress(answers.target)
    const tx = {
      type: 'transfer',
      from: USER.address,
      to: to,
      amount: answers.amount,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO SEND SOME AMOUNT OF TOKENS TO MULTIPLE ACCOUNTS
vorpal.command('distribute', 'distributes tokens to multiple accounts')
  .action(async function (_, callback) {
    const answers = await this.prompt([{
      type: 'input',
      name: 'targets',
      message: 'Enter the target accounts separated by spaces: ',
      filter: values => values.split` `.map(target => walletEntries[target].address)
    },
    {
      type: 'number',
      name: 'amount',
      message: 'How many tokens do you want to send each target: ',
      filter: value => parseInt(value)
    }])
    const tx = {
      type: 'distribute',
      from: USER.address,
      recipients: answers.targets,
      amount: answers.amount,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO SEND A MESSAGE TO ANOTHER USER ON THE NETWORK
vorpal.command('message', 'sends a message to another user')
  .action(async function (_, callback) {
    const answers = await this.prompt([{
      type: 'input',
      name: 'to',
      message: 'Enter the alias or publicKey of the target: '
    },
    {
      type: 'input',
      name: 'message',
      message: 'Enter the message: '
    }])
    const to = await getAddress(answers.to)
    const data = await getAccountData(USER.address)
    const handle = data.account.alias
    if (to === undefined || to === null) {
      this.log("Account doesn't exist for: ", answers.to)
      callback()
    }
    const result = await getToll(to, USER.address)
    if (result.error) {
      this.log(`There was an error retrieving the toll for ${answers.to}`)
      this.log(result.error)
      callback()
    } else {
      const answer = await this.prompt({
        type: 'list',
        name: 'confirm',
        message: `The toll for sending this user a message is ${result.toll}, continue? `,
        choices: [{ name: 'yes', value: true, short: true }, { name: 'no', value: false, short: false }],
        default: 'yes'
      })
      if (answer.confirm) {
        const message = stringify({
          body: answers.message,
          handle,
          timestamp: Date.now()
        })
        const encryptedMsg = crypto.encrypt(
          message,
          crypto.convertSkToCurve(USER.keys.secretKey),
          crypto.convertPkToCurve(to)
        )
        const tx = {
          type: 'message',
          from: USER.address,
          to: to,
          chatId: crypto.hash([USER.address, to].sort((a, b) => a < b).join``),
          message: encryptedMsg,
          timestamp: Date.now()
        }
        crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
        injectTx(tx).then(res => {
          this.log(res)
          callback()
        })
      } else {
        callback()
      }
    }
  })

// COMMAND TO SET A TOLL FOR PEOPLE NOT ON YOUR FRIENDS LIST THAT SEND YOU MESSAGES
vorpal.command('toll', 'sets a toll people must you in order to send you messages')
  .action(async function (_, callback) {
    const answer = await this.prompt({
      type: 'number',
      name: 'toll',
      message: 'Enter the toll: ',
      filter: value => parseInt(value)
    })
    const tx = {
      type: 'toll',
      from: USER.address,
      toll: answer.toll,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO ADD A FRIEND TO YOUR USER ACCOUNT'S FRIEND LIST
vorpal.command('add friend', 'adds a friend to your account')
  .action(async function (args, callback) {
    const answer = await this.prompt({
      type: 'input',
      name: 'friend',
      message: 'Enter the alias or publicKey of the friend: '
    })
    const to = await getAddress(answer.friend)
    if (to === undefined || to === null) {
      this.log("Target account doesn't exist for: ", answer.friend)
      callback()
    }
    const tx = {
      type: 'friend',
      alias: answer.friend,
      from: USER.address,
      to: to,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO REMOVE A FRIEND FROM YOUR USER ACCOUNT'S FRIEND LIST
vorpal.command('remove friend', 'removes a friend from your account')
  .action(async function (_, callback) {
    const answer = await this.prompt({
      type: 'input',
      name: 'friend',
      message: 'Enter the alias or publicKey of the friend to remove: '
    })
    const to = await getAddress(answer.friend)
    if (to === undefined || to === null) {
      this.log("Target account doesn't exist for: ", answer.friend)
      callback()
    }
    const tx = {
      type: 'remove_friend',
      from: USER.address,
      to: to,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO STAKE TOKENS IN ORDER TO RUN A NODE
// TODO
vorpal.command('stake', 'stakes tokens in order to operate a node')
  .action(async function (args, callback) {
    const parameters = await queryParameters()
    const answer = await this.prompt({
      type: 'list',
      name: 'confirm',
      message: `The required staking amount is ${parameters.stakeRequired}, continue? `,
      choices: [{ name: 'yes', value: true, short: true }, { name: 'no', value: false, short: false }]
    })
    if (answer.confirm) {
      const tx = {
        type: 'stake',
        from: USER.address,
        stake: parameters.stakeRequired,
        timestamp: Date.now()
      }
      crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
      injectTx(tx).then(res => {
        this.log(res)
        callback()
      })
    } else {
      this.log('cancelled')
      callback()
    }
  })

// COMMAND TO CLAIM THE TOKENS FROM THE ULT SNAPSHOT
// TODO VALIDATE ETHEREUM ADDRESS SOMEHOW
vorpal.command('claim', 'submits a claim transaction for the snapshot')
  .action(function (_, callback) {
    const tx = {
      type: 'snapshot_claim',
      from: USER.address,
      to: '0'.repeat(64),
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO SUBMIT A PROPOSAL
vorpal.command('proposal', 'submits a proposal to change network parameters')
  .action(async function (args, callback) {
    const network = await queryParameters()
    const defaults = network.CURRENT
    this.log('Choose the network parameters (Using default value keeps the current parameter value)')
    const answers = await this.prompt([{
      type: 'input',
      name: 'title',
      message: 'Enter a Title for your proposal: ',
      default: defaults.title
    },
    {
      type: 'input',
      name: 'description',
      message: 'Enter a description for your proposal: ',
      default: defaults.description
    },
    {
      type: 'number',
      name: 'nodeRewardInterval',
      message: 'Specify node reward interval (in minutes): ',
      default: defaults.nodeRewardInterval,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'nodeRewardAmount',
      message: 'Specify node reward amount: ',
      default: defaults.nodeRewardAmount,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'nodePenalty',
      message: 'Specify node penalty amount: ',
      default: defaults.nodePenalty,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'transactionFee',
      message: 'Specify transaction fee: ',
      default: defaults.transactionFee,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'stakeRequired',
      message: 'Specify stake requirement: ',
      default: defaults.stakeRequired,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'maintenanceInterval',
      message: 'Specify maintenance interval (in minutes): ',
      default: defaults.maintenanceInterval,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'maintenanceFee',
      message: 'Specify maintenance fee: ',
      default: defaults.maintenanceFee,
      filter: value => parseFloat(value)
    },
    {
      type: 'number',
      name: 'proposalFee',
      message: 'Specify proposal fee: ',
      default: defaults.proposalFee,
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'devProposalFee',
      message: 'Specify dev proposal fee: ',
      default: defaults.devProposalFee,
      filter: value => parseInt(value)
    }])
    const issue = await getIssueCount()
    const proposal = await getProposalCount()
    const tx = {
      type: 'proposal',
      from: USER.address,
      proposal: crypto.hash(`issue-${issue}-proposal-${proposal + 1}`),
      issue: crypto.hash(`issue-${issue}`),
      parameters: answers,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO SUBMIT A DEV_PROPOSAL
vorpal.command('dev proposal', 'submits a development proposal')
  .action(async function (_, callback) {
    const answers = await this.prompt([{
      type: 'input',
      name: 'title',
      message: 'Enter a title for the development proposal: ',
      default: `Default title`
    },
    {
      type: 'input',
      name: 'description',
      message: 'Enter a description for the proposal: ',
      default: `${USER.address.slice(0, 5)}... proposal`
    },
    {
      type: 'number',
      name: 'totalAmount',
      message: 'Enter the requested funds: ',
      default: 10000,
      filter: value => parseInt(value)
    },
    {
      type: 'input',
      name: 'payAddress',
      message: 'Enter the address for payment: ',
      default: USER.address
    },
    {
      type: 'list',
      name: 'plan',
      message: 'Select the payment plan',
      choices: ['single', 'multiple']
    }])

    let paymentCount, delay

    if (answers.plan === 'multiple') {
      await this.prompt([{
        type: 'number',
        name: 'count',
        message: 'Enter the number of payments: ',
        default: 5,
        filter: value => parseInt(value)
      },
      {
        type: 'number',
        name: 'delay',
        message: 'Enter the delay between payments (in minutes): ',
        default: 1,
        filter: value => parseInt(value)
      }], result => {
        paymentCount = result.count
        delay = result.delay * ONE_MINUTE
      })
    } else {
      paymentCount = 1
      delay = 0
    }

    const payments = new Array(paymentCount).fill(1).map((_, i) => ({
      amount: (1 / paymentCount),
      delay: delay * i
    }))

    const latestIssue = await getDevIssueCount()
    const count = await getDevProposalCount()
    const tx = {
      type: 'dev_proposal',
      from: USER.address,
      devIssue: crypto.hash(`dev-issue-${latestIssue}`),
      devProposal: crypto.hash(`dev-issue-${latestIssue}-dev-proposal-${count + 1}`),
      totalAmount: answers.totalAmount,
      payments: payments,
      title: answers.title,
      description: answers.description,
      payAddress: answers.payAddress,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO VOTE FOR A PROPOSAL
vorpal.command('vote', 'vote for a proposal')
  .action(async function (args, callback) {
    const latest = await getIssueCount()
    let proposals = await queryLatestProposals()
    if (proposals.length < 1) {
      this.log('There are currently no active proposals to vote on')
      callback()
    }
    this.log('Here are the current proposals')
    for (const prop of proposals) {
      this.log(prop)
    }

    proposals = proposals.map(prop => ({
      name: prop.number,
      value: prop.number,
      short: prop.number
    }))

    const answers = await this.prompt([{
      type: 'list',
      name: 'proposal',
      message: 'Pick the proposal number',
      choices: [...proposals],
      filter: value => parseInt(value)
    },
    {
      type: 'number',
      name: 'amount',
      message: 'How many tokens will you vote with? ',
      default: 50,
      filter: value => parseInt(value)
    }])

    const tx = {
      type: 'vote',
      from: USER.address,
      issue: crypto.hash(`issue-${latest}`),
      proposal: crypto.hash(`issue-${latest}-proposal-${answers.proposal}`),
      amount: answers.amount,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO VOTE FOR A DEV_PROPOSAL
vorpal.command('vote dev', 'vote for a development proposal')
  .action(async function (args, callback) {
    const latest = await getDevIssueCount()
    let devProposals = await queryLatestDevProposals()
    if (devProposals.length < 1) {
      this.log('There are currently no active development proposals to vote on')
      callback()
    }
    this.log('Here are the current developer proposals')
    for (const prop of devProposals) {
      this.log(prop)
    }
    devProposals = devProposals.map(prop => ({
      name: prop.number,
      value: prop.number,
      short: prop.description
    }))

    const answers = await this.prompt([{
      type: 'list',
      name: 'proposal',
      message: 'Pick the dev proposal number',
      choices: [...devProposals],
      filter: value => parseInt(value)
    },
    {
      type: 'list',
      name: 'approve',
      message: 'Choose your vote type',
      choices: [{ name: 'approve', value: true, short: true }, { name: 'reject', value: false, short: false }]
    },
    {
      type: 'number',
      name: 'amount',
      message: 'How many tokens will you vote with? ',
      default: 50,
      filter: value => parseInt(value)
    }])

    const tx = {
      type: 'dev_vote',
      from: USER.address,
      devIssue: crypto.hash(`dev-issue-${latest}`),
      devProposal: crypto.hash(`dev-issue-${latest}-dev-proposal-${answers.proposal}`),
      amount: answers.amount,
      approve: answers.approve,
      timestamp: Date.now()
    }
    crypto.signObj(tx, USER.keys.secretKey, USER.keys.publicKey)
    injectTx(tx).then(res => {
      this.log(res)
      callback()
    })
  })

// COMMAND TO POLL FOR MESSAGES BETWEEN 2 USERS AFTER A SPECIFIED TIMESTAMP
vorpal.command('message poll <to>', 'gets messages between you and <to>')
  .action(async function (args, callback) {
    const to = await getAddress(args.to)
    let messages = await queryMessages(USER.address, to)
    messages = messages.map(message =>
      JSON.parse(crypto.decrypt(
        message,
        crypto.convertSkToCurve(USER.keys.secretKey),
        crypto.convertPkToCurve(to)
      ).message)
    )
    this.log(messages)
    callback()
  })

// QUERY'S A LOCAL WALLET ACCOUNT OR ALL ACCOUNTS ON THE HOST IF LEFT BLANK
vorpal.command('query [account]', 'gets data for the account associated with the given [wallet]. Otherwise, gets all network data.')
  .action(async function (args, callback) {
    let address
    if (args.account !== undefined) address = walletEntries[args.account].address
    this.log(`Querying network for ${address ? args.account : 'all data'} `)
    this.log(address)
    getAccountData(address).then(res => {
      try {
        this.log(res)
      } catch (err) {
        this.log(err)
      } finally {
        callback()
      }
    })
  })

// COMMAND TO SPAM THE NETWORK WITH A SPECIFIC TRANSACTION TYPE
// TODO ADD LIBERDUS SPECIFIC TRANSACTIONS TO THIS
vorpal
  .command(
    'spam transactions <type> <accounts> <count> <tps> <ports>',
    'spams the network with <type> transactions <count> times, with <account> number of accounts, at <tps> transactions per second'
  )
  .action(async function (args, callback) {
    const accounts = createAccounts(args.accounts)
    const txs = makeTxGenerator(accounts, args.count, args.type)
    const seedNodes = await getSeedNodes()
    this.log('SEED_NODES:', seedNodes)
    // const ports = seedNodes.map(url => url.port)
    const nodes = seedNodes.map(url => `${url.ip}:${url.port}`)
    await spamTxs({ txs, rate: args.tps, nodes, saveFile: 'spam-test.json' })
    this.log('Done spamming...')
    callback()
  })

// COMMAND TO LOG OUT QUERYS FOR NETWORK DATA (ISSUES - PROPOSALS - DEV_PROPOSALS)
// TODO ADD MORE QUERYS HERE
vorpal.command('get <type>', 'query the network for <type> account')
  .action(async function (args, callback) {
    switch (args.type) {
      case 'params': {
        this.log(await queryParameters())
        break
      }
      case 'windows': {
        this.log(await queryWindow())
        break
      }
      case 'nodeParams': {
        this.log(await queryNodeParameters())
        break
      }
      case 'account': {
        const answer = await this.prompt({
          type: 'input',
          name: 'alias',
          message: 'Enter alias: '
        })
        const address = await getAddress(answer.alias)
        if (address) {
          this.log(await getAccountData(address))
        }
        break
      }
      case 'latestIssue' : {
        this.log(await queryLatestIssue())
        break
      }
      case 'latestDevIssue' : {
        this.log(await queryLatestDevIssue())
        break
      }
      case 'issues' : {
        this.log(await queryIssues())
        break
      }
      case 'devIssues' : {
        this.log(await queryDevIssues())
        break
      }
      case 'latestProposals' : {
        this.log(await queryLatestProposals())
        break
      }
      case 'latestDevProposals' : {
        this.log(await queryLatestDevProposals())
        break
      }
      case 'proposals' : {
        this.log(await queryProposals())
        break
      }
      case 'devProposals' : {
        this.log(await queryDevProposals())
        break
      }
      default : {
        this.log('Query type unknown')
      }
    }
    callback()
  })

vorpal.command('init', 'sets the user wallet if it exists, else creates it')
  .action(function (_, callback) {
    this.prompt({
      type: 'input',
      name: 'user',
      message: 'Enter wallet name: '
    }, result => {
      callback(null, vorpal.execSync('wallet create ' + result.user))
    })
  })

// COMMAND TO CREATE A LOCAL WALLET KEYPAIR
vorpal.command('wallet create <name>', 'creates a wallet <name>')
  .action(function (args, callback) {
    if (typeof walletEntries[args.name] !== 'undefined' && walletEntries[args.name] !== null) {
      return walletEntries[args.name]
    } else {
      const user = createEntry(args.name, args.id)
      return user
    }
  })

// COMMAND TO LIST ALL THE WALLET ENTRIES YOU HAVE LOCALLY
vorpal.command('wallet list [name]', 'lists wallet for [name]. Otherwise, lists all wallets')
  .action(function (args, callback) {
    let wallet = walletEntries[args.name]
    if (typeof wallet !== 'undefined' && wallet !== null) {
      this.log(wallet)
    } else {
      this.log(walletEntries)
    }
    callback()
  })

vorpal.command('use <name>', 'uses <name> wallet for transactions')
  .action(function (args, callback) {
    USER = vorpal.execSync('wallet create ' + args.name)
    this.log('Now using wallet: ' + args.name)
    callback()
  })

vorpal.command('transactions', 'gets all the transactions for your account')
  .action(async function (_, callback) {
    this.log(await queryTransactions())
    callback()
  })

vorpal.command('kill node <host>', 'Kicks node running on host <host>')
  .action(async function (args, callback) {
    await axios.post(`http://${args.host}/exit`)
    callback()
  })

vorpal.command('debug snapshot [host]', 'takes a snapshot of the heap on node [host] or the host you are connected to (if not defined)')
  .action(async function (args, callback) {
    if (args.host) {
      this.log(await takeSnapshot(args.host))
    } else {
      this.log(await takeSnapshot(HOST))
    }
    callback()
  })

vorpal.command('debug exit <code> [host]', 'kills node running on [host] with exit code <code>. Use current host if no [host] provided')
  .action(async function (args, callback) {
    if (args.code === undefined) {
      this.log('Must provide an exit code')
    } else {
      await axios.post(`http://${args.host || HOST}/debug/exit`, { code: args.code })
    }
    callback()
  })

vorpal.delimiter('>').show()
vorpal.exec('init').then(res => (USER = res))
