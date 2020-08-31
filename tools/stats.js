/*
*  计算区块数据
* */

const _ = require('lodash');
const Web3 = require('web3');

const {BlockStat} = require('../db.js');

// 连接服务器节点
const config = {nodeAddr: '192.168.5.251', wsPort: 8545, bulkSize: 100};

//加载config.json文件
try {
    let local = require('../config.json');
    _.extend(config, local);
    console.log('config.json found.');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        let local = require('../config.json');
        _.extend(config, local);
        console.log('No config file found. Using default configuration... (config.json)');
    } else {
        throw error;
        process.exit(1);
    }
}
console.log(`Connecting ${config.nodeAddr}:${config.wsPort}...`);

// 设置连接web3的IP
const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://${config.nodeAddr}:${config.wsPort.toString()}`));

if ('quiet' in config && config.quiet === true) {
    console.log('Quiet mode enabled');
}

const updateStats = async (range, interval, rescan) => {
    let latestBlock = await web3.eth.getBlockNumber();

    interval = Math.abs(parseInt(interval));
    if (!range) {
        range = 1000;
    }
    range *= interval;
    if (interval >= 10) {
        latestBlock -= latestBlock % interval;
    }
    getStats(web3, latestBlock, null, latestBlock - range, interval, rescan);
};

let getStats = function (web3, blockNumber, nextBlock, endNumber, interval, rescan) {
    if (endNumber < 0) endNumber = 0;
    if (blockNumber <= endNumber) {
        if (rescan) {
            process.exit(9);
        }
        return;
    }

    if (web3.eth.net.isListening()) {
        web3.eth.getBlock(blockNumber, true, (error, blockData) => {
            if (error) {
                console.log(`Warning: error on getting block with hash/number: ${
                    blockNumber}: ${error}`);
            } else if (blockData == null) {
                console.log(`Warning: null block data received from the block with hash/number: ${
                    blockNumber}`);
            } else {
                if (nextBlock) checkBlockDBExistsThenWrite(web3, blockData, nextBlock, endNumber, interval, rescan);
                else checkBlockDBExistsThenWrite(web3, blockData, null, endNumber, interval, rescan);
            }
        });
    } else {
        console.log(`${'Error: Aborted due to web3 is not connected when trying to ' +
        'get block '}${blockNumber}`);
        process.exit(9);
    }
};

let checkBlockDBExistsThenWrite = function (web3, blockData, nextBlock, endNumber, interval, rescan) {
    BlockStat.find({number: blockData.number}, (err, b) => {
        if (!b.length && nextBlock) {
            // calc hashrate, txCount, blocktime, uncleCount
            const stat = {
                'number': blockData.number,
                'timestamp': blockData.timestamp,
                'difficulty': blockData.difficulty,
                'txCount': blockData.transactions.length,
                'gasUsed': blockData.gasUsed,
                'gasLimit': blockData.gasLimit,
                'miner': blockData.miner,
                'blockTime': (nextBlock.timestamp - blockData.timestamp) / (nextBlock.number - blockData.number),
                'uncleCount': blockData.uncles.length,
            };
            new BlockStat(stat).save((err, s) => {
                if (!('quiet' in config && config.quiet === true)) {
                    console.log(s);
                }
                if (typeof err !== 'undefined' && err) {
                    console.log(`${'Error: Aborted due to error on ' + 'block number '}${blockData.number.toString()}: ${
                        err}`);
                    process.exit(9);
                } else {
                    if (!('quiet' in config && config.quiet === true)) {
                        console.log(`DB successfully written for block number ${blockData.number.toString()}`);
                    }
                    getStats(web3, blockData.number - interval, blockData, endNumber, interval, rescan);
                }
            });
        } else {
            if (rescan || !nextBlock) {
                getStats(web3, blockData.number - interval, blockData, endNumber, interval, rescan);
                if (nextBlock) {
                    if (!('quiet' in config && config.quiet === true)) {
                        console.log(`WARN: block number: ${blockData.number.toString()} already exists in DB.`);
                    }
                }
            } else {
                if (!('quiet' in config && config.quiet === true)) {
                    console.error(`Aborting because block number: ${blockData.number.toString()} already exists in DB.`);
                }

            }
        }
    });
};

const minutes = 1;
statInterval = minutes * 60 * 1000;

let rescan = false; /* rescan: true - rescan range */
let range = 1000;
let interval = 100;

if (process.env.RESCAN) {
    const tmp = process.env.RESCAN.split(/:/);
    if (tmp.length > 1) {
        interval = Math.abs(parseInt(tmp[0]));
        if (tmp[1]) {
            range = Math.abs(parseInt(tmp[1]));
        }
    }
    let i = interval;
    let j = 0;
    for (let j = 0; i >= 10; j++) {
        i = parseInt(i / 10);
    }
    interval = Math.pow(10, j);
    console.log(`Selected interval = ${interval}`);

    rescan = true;
}

updateStats(range, interval, rescan);

if (!rescan) {
    setInterval(() => {
        updateStats(range, interval);
    }, statInterval);
}
