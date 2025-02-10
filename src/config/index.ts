import fs from 'fs'
import path from 'path'
import Prop from 'dot-prop'
import merge from 'deepmerge'
import minimist from 'minimist'
import { NetworkParameters } from '../@types'
import { Utils } from '@shardus/types'
import { DevSecurityLevel, ShardusTypes } from '@shardus/core'
import * as utils from '../utils'

export const networkAccount = '0'.repeat(64)

// HELPFUL TIME CONSTANTS IN MILLISECONDS
export const ONE_SECOND = 1000
export const ONE_MINUTE = 60 * ONE_SECOND
export const ONE_HOUR = 60 * ONE_MINUTE
export const ONE_DAY = 24 * ONE_HOUR
// export const ONE_WEEK = 7 * ONE_DAY
// export const ONE_YEAR = 365 * ONE_DAY

// MIGHT BE USEFUL TO HAVE TIME CONSTANTS IN THE FORM OF CYCLES
export const cycleDuration = 60
const reduceTimeFromTxTimestamp = cycleDuration * ONE_SECOND
const halfCycleDuration = (cycleDuration * 1000) / 2

// DEV SETTINGS
export const TIME_FOR_PROPOSALS = (2 * cycleDuration * 1000) + halfCycleDuration
export const TIME_FOR_VOTING = (2 * cycleDuration * 1000) + halfCycleDuration
export const TIME_FOR_GRACE = (2 * cycleDuration * 1000) + halfCycleDuration
export const TIME_FOR_APPLY = (2 * cycleDuration * 1000) + halfCycleDuration

export const TIME_FOR_DEV_PROPOSALS = (2 * cycleDuration * 1000) + halfCycleDuration
export const TIME_FOR_DEV_VOTING = (2 * cycleDuration * 1000) + halfCycleDuration
export const TIME_FOR_DEV_GRACE = (2 * cycleDuration * 1000) + halfCycleDuration
export const TIME_FOR_DEV_APPLY = (2 * cycleDuration * 1000) + halfCycleDuration

export const TOTAL_DAO_DURATION = TIME_FOR_PROPOSALS + TIME_FOR_VOTING + TIME_FOR_GRACE + TIME_FOR_APPLY

// PROD SETTINGS
// export const TIME_FOR_PROPOSALS = ONE_DAY
// export const TIME_FOR_VOTING = 3 * ONE_DAY
// export const TIME_FOR_GRACE = ONE_DAY
// export const TIME_FOR_APPLY = 2 * ONE_DAY

// export const TIME_FOR_DEV_PROPOSALS = ONE_DAY
// export const TIME_FOR_DEV_VOTING = 3 * ONE_DAY
// export const TIME_FOR_DEV_GRACE = ONE_DAY
// export const TIME_FOR_DEV_APPLY = 2 * ONE_DAY

// INITIAL NETWORK PARAMETERS FOR LIBERDUS
export const INITIAL_PARAMETERS: NetworkParameters = {
  title: 'Initial parameters',
  description: 'These are the initial network parameters liberdus started with',
  nodeRewardInterval: ONE_HOUR, //ONE_HOUR,
  nodeRewardAmountUsd: utils.libToWei(1),
  nodePenaltyUsd: utils.libToWei(10),
  stakeRequiredUsd: utils.libToWei(10),
  restakeCooldown: 30 * ONE_MINUTE,
  transactionFee: utils.libToWei(0.1),
  maintenanceInterval: ONE_DAY,
  maintenanceFee: utils.libToWei(0),
  proposalFee: utils.libToWei(50),
  devProposalFee: utils.libToWei(50),
  faucetAmount: utils.libToWei(10),
  defaultToll: utils.libToWei(1),
  tollNetworkTaxPercent: 1, // 1%
  tollTimeout: 7 * ONE_DAY,
  minVersion: '2.3.4',
  activeVersion: '2.3.4',
  latestVersion: '2.3.4',
  archiver: {
    minVersion: '3.5.6',
    activeVersion: '3.5.6',
    latestVersion: '3.5.6',
  },
  stabilityScaleMul: 1000,
  stabilityScaleDiv: 1000,
  txPause: false,
  certCycleDuration: 30,
  enableNodeSlashing: false,
  slashing: {
    enableLeftNetworkEarlySlashing: false,
    enableSyncTimeoutSlashing: false,
    enableNodeRefutedSlashing: false,
    leftNetworkEarlyPenaltyPercent: 0.2,
    syncTimeoutPenaltyPercent: 0.2,
    nodeRefutedPenaltyPercent: 0.2,
  },
}

function replaceAll(str, find, replace) {
  return str.replace(new RegExp(find, 'g'), replace)
}

function createJointKey(keys) {
  let jointKey = ''
  for (let key of keys) {
    if (jointKey.length > 0) {
      jointKey += '_' + key
    } else {
      jointKey += key
    }
  }
  return jointKey
}

function getPropertyFromJointKey(obj, jointKey) {
  if (!obj || !jointKey) return
  if (jointKey.split('_').length === 1) return obj[jointKey]
  else {
    let nestedKey = replaceAll(jointKey, '_', '.')
    console.log('nestedKey', nestedKey)
    let value = Prop.get(obj, nestedKey)
    console.log('value', value)
    return value
  }
}

function setPropertyToJointKey(obj, jointKey, value) {
  if (!obj || !jointKey) return
  if (jointKey.split('_').length === 1) obj[jointKey] = value
  else {
    let nestedKey = replaceAll(jointKey, '_', '.')
    Prop.set(obj, nestedKey, value)
  }
}

function overwriteFromEnvOrArgs(jointKey, overwriteInfo) {
  let { config, env, args } = overwriteInfo
  // Override config from ENV variable
  overwriteConfig(jointKey, config, env)
  const parsedArgs = minimist(args.slice(2))
  // Override config from cli args
  overwriteConfig(jointKey, config, parsedArgs)
}

function overwriteConfig(jointKey, config, overWriteObj) {
  if (overWriteObj[jointKey]) {
    switch (typeof getPropertyFromJointKey(config, jointKey)) {
      case 'number': {
        setPropertyToJointKey(config, jointKey, Number(overWriteObj[jointKey]))
        break
      }
      case 'string': {
        setPropertyToJointKey(config, jointKey, String(overWriteObj[jointKey]))
        break
      }
      case 'object': {
        try {
          var parameterStr = overWriteObj[jointKey]
          if (parameterStr) {
            let parameterObj = JSON.parse(parameterStr)
            setPropertyToJointKey(config, jointKey, parameterObj)
          }
        } catch (e) {
          console.log(e)
          console.log('Unable to JSON parse', overWriteObj[jointKey])
        }
        break
      }
      case 'boolean': {
        setPropertyToJointKey(config, jointKey, String(overWriteObj[jointKey]).toLowerCase() === 'true')
        break
      }
      default: {
      }
    }
  }
}

export function overrideDefaultConfig(defaultConfig, env: NodeJS.ProcessEnv, args: string[]) {
  let config = JSON.parse(JSON.stringify(defaultConfig))
  let overwriteInfo = { config, env, args }
  for (const key1 in config) {
    if (typeof config[key1] === 'object' && Object.keys(config[key1]).length > 0) {
      for (const key2 in config[key1]) {
        if (typeof config[key1][key2] === 'object' && Object.keys(config[key1][key2]).length > 0) {
          for (const key3 in config[key1][key2]) {
            overwriteFromEnvOrArgs(createJointKey([key1, key2, key3]), overwriteInfo)
          }
        } else {
          overwriteFromEnvOrArgs(createJointKey([key1, key2]), overwriteInfo)
        }
      }
    } else {
      overwriteFromEnvOrArgs(createJointKey([key1]), overwriteInfo)
    }
  }
  return config
}

export const enum FilePaths {
  LIBERDUS_DB = 'db/liberdus.sqlite',
  DB = 'db.sqlite',
  CONFIG = 'config.json',
  CLI_PACKAGE = '/home/node/app/cli/package.json',
  GUI_PACKAGE = '/home/node/app/gui/package.json',
}

interface LiberdusFlags {
  VerboseLogs: boolean
  NewStorageIndex: boolean
  UseDBForAccounts: boolean //Use Sql to store in memory accounts instead of simple accounts object map
  numberOfLuckyNodes: number
  ModeEnabled: boolean
  StakingEnabled: boolean
  AdminCertEnabled: boolean
  minActiveNodesForStaking: number
  MinStakeCertSig: number
  FullCertChecksEnabled: boolean // do we run all of the cert checks when signing.  This config may go away soon after testing.
  certCycleDuration: number
  lowStakePercent: number
  allowForceUnstake: boolean
  numberOfNodesToInjectPenaltyTx: number
  useEthereumAddress: boolean
  siloAddress: boolean
  siloAddressBitLength: number
  cacheMaxCycleAge: number
  cacheMaxItemPerTopic: number
  transferMemoLimit: number
  messageSizeLimit: number
}

export const LiberdusFlags: LiberdusFlags = {
  NewStorageIndex: true,
  UseDBForAccounts: true,
  numberOfLuckyNodes: 1,
  VerboseLogs: true,
  AdminCertEnabled: true,
  StakingEnabled: true,
  ModeEnabled: true,
  minActiveNodesForStaking: 5,
  MinStakeCertSig: 1, // this is the minimum amount of signature required for stake certification. will move to network param in future.
  FullCertChecksEnabled: true,
  certCycleDuration: 30,
  lowStakePercent: 0.2,
  allowForceUnstake: true,
  numberOfNodesToInjectPenaltyTx: 5,
  useEthereumAddress: true,
  siloAddress: true,
  siloAddressBitLength: 3,
  cacheMaxCycleAge: 10,
  cacheMaxItemPerTopic: 3000,
  transferMemoLimit: 140, // 140 characters
  messageSizeLimit: 100, // 100kb
}

export function updateLiberdusFlag(key: string, value: string | number | boolean): void {
  /* eslint-disable security/detect-object-injection */
  try {
    if (LiberdusFlags[key] == null) {
      console.log(`There is no liberdus flag for ${key}`)
      return
    }
    if (typeof LiberdusFlags[key] !== typeof value) {
      console.log(`Type of new value is different from the type of existing flag ${key}`)
      return
    }
    LiberdusFlags[key] = value
    console.log(`Liberdus flag ${key} is set to ${value}`)
  } catch (e) {
    console.log(`Error: updateLiberdusFlag`, e)
  }
  /* eslint-enable security/detect-object-injection */
}

const overwriteMerge = (target: any[], source: any[]): any[] => source // eslint-disable-line @typescript-eslint/no-explicit-any

//TODO: improve typing here
let config = {
  server: {
    globalAccount: networkAccount,
    baseDir: './',
  },
} as ShardusTypes.ShardusConfiguration

// eslint-disable-next-line security/detect-non-literal-fs-filename
if (fs.existsSync(path.join(process.cwd(), FilePaths.CONFIG))) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileConfig = Utils.safeJsonParse(fs.readFileSync(path.join(process.cwd(), FilePaths.CONFIG)).toString())
  config = merge(config, fileConfig, { arrayMerge: overwriteMerge })
}

if (process.env.BASE_DIR) {
  const baseDir = process.env.BASE_DIR || '.'
  let baseDirFileConfig = {}

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(path.join(baseDir, FilePaths.CONFIG))) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    baseDirFileConfig = Utils.safeJsonParse(fs.readFileSync(path.join(baseDir, FilePaths.CONFIG)).toString())
  }
  config = merge(config, baseDirFileConfig, { arrayMerge: overwriteMerge })
  config.server.baseDir = process.env.BASE_DIR
}

if (process.env.APP_SEEDLIST) {
  config = merge(
    config,
    {
      server: {
        p2p: {
          existingArchivers: [
            {
              ip: process.env.APP_SEEDLIST,
              port: process.env.APP_SEEDLIST_PORT || 4000,
              publicKey: process.env.APP_SEEDLIST_PUBLIC_KEY || '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3',
            },
          ],
        },
      },
    },
    { arrayMerge: overwriteMerge },
  )
}

// EXISTING_ARCHIVERS env has to be passed in string format!
if (process.env.EXISTING_ARCHIVERS) {
  const existingArchivers = Utils.safeJsonParse(process.env.EXISTING_ARCHIVERS)
  if (existingArchivers.length > 0) {
    config = merge(
      config,
      {
        server: {
          p2p: {
            existingArchivers,
          },
        },
      },
      { arrayMerge: overwriteMerge },
    )
  }
}

if (process.env.APP_MONITOR) {
  config = merge(
    config,
    {
      server: {
        reporting: {
          recipient: `http://${process.env.APP_MONITOR}:3000/api`,
        },
      },
    },
    { arrayMerge: overwriteMerge },
  )
}

if (process.env.APP_IP) {
  config = merge(
    config,
    {
      server: {
        ip: {
          externalIp: process.env.APP_IP,
          internalIp: process.env.APP_IP,
        },
      },
    },
    { arrayMerge: overwriteMerge },
  )
}

config = merge(config, {
  server: {
    p2p: {
      cycleDuration: cycleDuration,
      minNodesToAllowTxs: 1, // to allow single node networks
      baselineNodes: process.env.baselineNodes ? parseInt(process.env.baselineNodes) : 32, // config used for baseline for entering recovery, restore, and safety. Should be equivalient to minNodes on network startup
      minNodes: process.env.minNodes ? parseInt(process.env.minNodes) : 32,
      maxNodes: process.env.maxNodes ? parseInt(process.env.maxNodes) : 1100,
      maxJoinedPerCycle: 10,
      maxSyncingPerCycle: 10,
      maxRotatedPerCycle: process.env.maxRotatedPerCycle ? parseInt(process.env.maxRotatedPerCycle) : 1,
      firstCycleJoin: 0,
      maxSyncTimeFloor: 1200, //Using 6000 for a restore from archiver, then set config at runtime back to 1200
      //  1200=20 minutes.  If the network lives a long time we may have to bump this up
      syncBoostEnabled: false,
      amountToGrow: 30,
      amountToShrink: 5,
      maxDesiredMultiplier: 1.2,
      maxScaleReqs: 250, // todo: this will become a variable config but this should work for a 500 node demo
      forceBogonFilteringOn: true,
      //these are new feature in 1.3.0, we can make them default:true in shardus-core later

      // 1.2.3 migration starts
      validateActiveRequests: true, //new logic to prevent already active nodes from submitting active requests
      // set back to false in 1.6.0
      //continueOnException: true, //Allow nodes to contineue on unhandled exceptions if the network is low on nodes
      useSignaturesForAuth: true, //This is a major performance upgrade for p2p tell
      // 1.2.3 migration ends

      uniqueRemovedIds: true, //1.3.1 migration. enabled by default in 1.4.0
      useLruCacheForSocketMgmt: true,
      lruCacheSizeForSocketMgmt: 500,
      uniqueRemovedIdsUpdate: true, // To enable on 1.4.1
      instantForwardReceipts: true, // To enable on 1.5.3
      validateArchiverAppData: false, // To enable this on new reset network

      // 1.5.5 migration
      //Notes:
      // todo this flag needs to be implemented:
      // it should activate nodes writing the new hashes to the cycle record , but the
      // full logic will be enabled in 1.5.6
      writeSyncProtocolV2: true,

      // 1.5.6 migration
      useSyncProtocolV2: true,

      //1.6.0 migration
      continueOnException: false,

      // 1.9.1 migration
      standbyListFastHash: true,
      //1.9.4 avoid issues with lost archiver system:
      lostArchiversCyclesToWait: 1000000,

      // 1.10.0 restart
      networkBaselineEnabled: true, // when enabled, new p2p config `baselineNodes` is the threshold for going into restore, recovery, and safety mode

      // 1.10.0 todo podA smoke/functional test with these on:
      // numberOfNodesToInjectPenaltyTx: 5, //this may not need a change but we should probably go ahead and include it
      rotationCountMultiply: 3,
      // 1.10.0
      standbyListCyclesTTL: 1440, //nodes only need to refresh once every 24 hours (which is 1440 60s cycles!)

      // 1.10.1
      extraNodesToAddInRestart: 5, //how many extra nodes to we add in restart phase so we dont get stuck in restore phase
      // 1.10.1
      cyclesToWaitForSyncStarted: 5, //raising this to 5 to reduce the chance of nodes getting booted out too soon

      forcedMode: '', //change to 'safety` to force network into safety mode (other modes not implemented and will not force network mode)
      // 1.10 x ? dev test   needs migration to release
      removeLostSyncingNodeFromList: true,

      //1.11.0
      rotationEdgeToAvoid: 0, //we are moving away from this feature in current testing.  There seem to be errors related to it
      allowActivePerCycle: 1,

      maxStandbyCount: 30000, //max allowed standby nodes count
      enableMaxStandbyCount: true,

      formingNodesPerCycle: 32, //how many nodes can be add in a cycle while in forming mode

      downNodeFilteringEnabled: false, //turning down node filtering off for diagnostics purposes
    },
    features: {
      //This feature will restrict transactions to only coin transfers
      dappFeature1enabled: true, //enabled for betanext 1.11.0
    },
  },
})

// rateLimiting and loadDetection settings
config = merge(config, {
  server: {
    rateLimiting: {
      limitRate: true,
      //check out isOverloaded and getWinningLoad to see how these work
      //what ever value is the highest is used to reject TXs at a sliding rate
      //i.e. if the limit is 0.6  and the load is 0.7 then we will reject 25% of TXs randomly (because that is 25% of the way to 1.0 from 0.6)
      //     when they get to 1.0 load (the max) they will reject 100% of TXs
      loadLimit: {
        //these are multipliers for internal and external factors
        internal: 0.6,
        external: 0.6,
        //these are multipliers three external load factors that can influence network scale up/down votes
        //however these multipler are used for rate limiting and it is highThreshold / lowThreshold that are used for voting
        //having a super fast computer will not impact this, it is about the collaborative health of the network based on
        //what is in our queue.  even though our queue may be different than other node it is similar because of overalp in
        //dynamic sharding ranges
        txTimeInQueue: 0.6,
        queueLength: 0.6,
        executeQueueLength: 0.6,
      },
    },
    loadDetection: {
      queueLimit: 150, // EXSS does the main limiting now queue limit is a secondary limit.  It should be higher that the exeutute queue limit
      executeQueueLimit: 150, // This limit how many items can be in the queue that will execute (apply) on our node
      // Example: if you a have a limit of 160 and we expect TXs to take 4 sec in consensus after a 6 second wait
      // then we look at 160 / 10 to see that 10tps sustained or more will give us a 1.0 load.
      // note that executeQueueLength value of 0.6 means we start rejecting TXs at 60% of the limit
      desiredTxTime: 120, // this is the average age of a TX in the queue.  we will only detect this if there are at least 20 txes in the queue
      highThreshold: 0.5, // This is mainly used to detect if any of our three parameters above are getting too high
      // if any of the three external load factors are above highload we will raise a high load
      // event and vote to the network if we are in the voter set for that cycle
      // if enough nodes vote or up, then desired node count will go up (although there is a limit based on current active nodes)
      lowThreshold: 0.2, // similar to highThreshold but for low values.
      // load below this will trigger a network scale down vote.
    },
  },
})

// Sharding and state manager settings
config = merge(config, {
  server: {
    sharding: {
      nodesPerConsensusGroup: process.env.nodesPerConsensusGroup ? parseInt(process.env.nodesPerConsensusGroup) : 16, //128 is the final goal
      nodesPerEdge: process.env.nodesPerEdge ? parseInt(process.env.nodesPerEdge) : 5,
      executeInOneShard: true,
    },
    stateManager: {
      accountBucketSize: 250, // todo: we need to re-test with higher numbers after some recent improvements
      includeBeforeStatesInReceipts: true, // 1.5.3 migration
      useNewPOQ: false, // 1.10.0 enabled required by archive server updates

      forwardToLuckyNodes: false, // 1.11.0 we seem to have more issues with this on.  can turn off for local testing

      removeStuckTxsFromQueue: true,
      removeStuckTxsFromQueue3: true,

      removeStuckChallengedTXs: true,

      stuckTxMoveTime: 3600000,

      stuckTxRemoveTime: 300000, // 5 min
      stuckTxRemoveTime3: 1000 * 60 * 2, // 2 min

      awaitingDataCanBailOnReceipt: true,
      reduceTimeFromTxTimestamp,
    },
  },
})

// features
config = merge(config, {
  server: {
    features: {
      //1.1.3
      fixHomeNodeCheckForTXGroupChanges: true,
      //1.1.4
      archiverDataSubscriptionsUpdate: true,
      startInServiceMode: false,
    },
  },
})

// Debug settings
config = merge(
  config,
  {
    server: {
      mode: 'debug', // todo: must set this to "release" for public networks or get security on endpoints. use "debug"
      // for easier debugging
      debug: {
        startInFatalsLogMode: false, // true setting good for big aws test with nodes joining under stress.
        startInErrorLogMode: true,
        robustQueryDebug: false,
        fakeNetworkDelay: 0,
        disableSnapshots: true, // do not check in if set to false
        countEndpointStart: -1,
        hashedDevAuth: '',
        devPublicKeys: {
          // '': DevSecurityLevel.Unauthorized,
          // These are production keys.  Use 'git apply use_test_key.patch' for unsafe local test keys
          // Never merge a commit with changes to these lines without approval.
          // always prefix with prettier ignore
          /* prettier-ignore */ '899de21e0c47a29be4319376a9207f5e63d8e5b7d296b8a6391e301e1f14cd32': DevSecurityLevel.High,
          '235a87986ef232e204d5672a5bc0d15201ad502f99ecf879109c53751deb8fca': DevSecurityLevel.High,
          '4f4559259253943837268209775c4c8731a24aac11ef923f616ea543bae9355a': DevSecurityLevel.High,
          '6128f995fd46a9be1af049d84d89424384770b0df3471b2eff4ddf476e399dd4': DevSecurityLevel.High,
          '0ad2caeba527f230f6b703fb6b50ad284968065c522eed42774107965dc0a1a7': DevSecurityLevel.High,
          '4561289434eff9b547250911ed0f75e38c16572c926c60f7a8a45c384d088835': DevSecurityLevel.High,
        },
        multisigKeys: {
          // always prefix with prettier ignore
          /* prettier-ignore */ '': DevSecurityLevel.High, // test key
          // always prefix with prettier ignore
        },
        checkAddressFormat: true, //enabled for 1.10.0
        enableCycleRecordDebugTool: false, // only enable if you want to debug variant cycle records
        enableScopedProfiling: false,
        minMultiSigRequiredForEndpoints: 1,
        minMultiSigRequiredForGlobalTxs: 1,
      },
    },
  },
  { arrayMerge: overwriteMerge },
)

export default config
