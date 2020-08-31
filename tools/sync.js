/*
* 该文件将开始从conf.json文件中提供的节点地址同步区块链
*/
require('../db.js');
const BigNumber = require('bignumber.js');
const _ = require('lodash');

const asyncL = require('async');
const Web3 = require('web3');

const ERC20ABI = require('human-standard-token-abi');

const fetch = require('node-fetch');

const mongoose = require('mongoose');
const etherUnits = require('../lib/etherUnits.js');
const {Market} = require('../db.js');

const Block = mongoose.model('Block');
const Transaction = mongoose.model('Transaction');
const Account = mongoose.model('Account');
const Contract = mongoose.model('Contract');
const TokenTransfer = mongoose.model('TokenTransfer');

const ERC20_METHOD_DIC = {'0xa9059cbb': 'transfer', '0xa978501e': 'transferFrom'};

const config = {nodeAddr: '192.168.5.251', port: 8545, bulkSize: 100};
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
const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://${config.nodeAddr}:${config.wsPort.toString()}`));

const normalizeTX = async (txData, receipt, blockData) => {
    const tx = {
        blockHash: txData.blockHash,
        blockNumber: txData.blockNumber,
        from: txData.from.toLowerCase(),
        hash: txData.hash.toLowerCase(),
        value: etherUnits.toEther(new BigNumber(txData.value), 'wei'),
        nonce: txData.nonce,
        r: txData.r,
        s: txData.s,
        v: txData.v,
        gas: txData.gas,
        gasUsed: receipt.gasUsed,
        gasPrice: String(txData.gasPrice),
        input: txData.input,
        transactionIndex: txData.transactionIndex,
        timestamp: blockData.timestamp,
    };

    if (receipt.status) {
        tx.status = receipt.status;
    }

    if (txData.to) {
        tx.to = txData.to.toLowerCase();
        return tx;
    } else if (txData.creates) {
        tx.creates = txData.creates.toLowerCase();
        return tx;
    } else {
        tx.creates = receipt.contractAddress.toLowerCase();
        return tx;
    }
};

let writeBlockToDB = function (config, blockData, flush) {
    const self = writeBlockToDB;
    if (!self.bulkOps) {
        self.bulkOps = [];
    }
    if (blockData && blockData.number >= 0) {
        self.bulkOps.push(new Block(blockData));
        if (!('quiet' in config && config.quiet === true)) {
            console.log(`\t- block #${blockData.number.toString()} inserted.`);
        }
    }

    if (flush && self.bulkOps.length > 0 || self.bulkOps.length >= config.bulkSize) {
        const bulk = self.bulkOps;
        self.bulkOps = [];
        if (bulk.length === 0) return;

        Block.collection.insert(bulk, (err, blocks) => {
            if (typeof err !== 'undefined' && err) {
                if (err.code === 11000) {
                    if (!('quiet' in config && config.quiet === true)) {
                        console.log(`Skip: Duplicate DB key : ${err}`);
                    }
                } else {
                    console.log(`Error: Aborted due to error on DB: ${err}`);
                    process.exit(9);
                }
            } else {
                if (!('quiet' in config && config.quiet === true)) {
                    console.log(`* ${blocks.insertedCount} blocks successfully written.`);
                }
            }
        });
    }
};

const writeTransactionsToDB = async (config, blockData, flush) => {
    const self = writeTransactionsToDB;
    if (!self.bulkOps) {
        self.bulkOps = [];
        self.blocks = 0;
    }
    if (!self.miners) {
        self.miners = [];
    }
    if (blockData) {
        self.miners.push({address: blockData.miner, blockNumber: blockData.number, type: 0});
    }
    if (blockData && blockData.transactions.length > 0) {
        for (d in blockData.transactions) {
            const txData = blockData.transactions[d];
            const receipt = await web3.eth.getTransactionReceipt(txData.hash);
            const tx = await normalizeTX(txData, receipt, blockData);
            // Contact creation tx, Event logs of internal transaction
            if (txData.input && txData.input.length > 2) {
                // Contact creation tx
                if (txData.to === null) {
                    // Support Parity & Geth case
                    if (txData.creates) {
                        contractAddress = txData.creates.toLowerCase();
                    } else {
                        contractAddress = receipt.contractAddress.toLowerCase();
                    }
                    const contractdb = {};
                    let isTokenContract = true;
                    const Token = new web3.eth.Contract(ERC20ABI, contractAddress);
                    contractdb.owner = txData.from;
                    contractdb.blockNumber = blockData.number;
                    contractdb.creationTransaction = txData.hash;
                    try {
                        const call = await web3.eth.call({to: contractAddress, data: web3.utils.sha3('totalSupply()')});
                        if (call === '0x') {
                            isTokenContract = false;
                        } else {
                            try {
                                contractdb.tokenName = await Token.methods.name().call();
                                contractdb.decimals = await Token.methods.decimals().call();
                                contractdb.symbol = await Token.methods.symbol().call();
                                contractdb.totalSupply = await Token.methods.totalSupply().call();
                            } catch (err) {
                                isTokenContract = false;
                            }
                        }
                    } catch (err) {
                        isTokenContract = false;
                    }
                    contractdb.byteCode = await web3.eth.getCode(contractAddress);
                    if (isTokenContract) {
                        contractdb.ERC = 2;
                    } else {
                        contractdb.ERC = 0;
                    }
                    Contract.update(
                        {address: contractAddress},
                        {$setOnInsert: contractdb},
                        {upsert: true},
                        (err) => {
                            if (err) {
                                console.log(err);
                            }
                        },
                    );
                } else {
                    const transfer = {
                        'hash': '', 'blockNumber': 0, 'from': '', 'to': '', 'contract': '', 'value': 0, 'timestamp': 0,
                    };
                    const methodCode = txData.input.substr(0, 10);
                    if (ERC20_METHOD_DIC[methodCode] === 'transfer' || ERC20_METHOD_DIC[methodCode] === 'transferFrom') {
                        if (ERC20_METHOD_DIC[methodCode] === 'transfer') {
                            transfer.from = txData.from;
                            transfer.to = `0x${txData.input.substring(34, 74)}`;
                            transfer.value = Number(`0x${txData.input.substring(74)}`);
                        } else {
                            // transferFrom
                            transfer.from = `0x${txData.input.substring(34, 74)}`;
                            transfer.to = `0x${txData.input.substring(74, 114)}`;
                            transfer.value = Number(`0x${txData.input.substring(114)}`);
                        }
                        transfer.method = ERC20_METHOD_DIC[methodCode];
                        transfer.hash = txData.hash;
                        transfer.blockNumber = blockData.number;
                        transfer.contract = txData.to;
                        transfer.timestamp = blockData.timestamp;
                        TokenTransfer.update(
                            {hash: transfer.hash},
                            {$setOnInsert: transfer},
                            {upsert: true},
                            (err) => {
                                if (err) {
                                    console.log(err);
                                }
                            },
                        );
                    }
                }
            }
            self.bulkOps.push(tx);
        }
        if (!('quiet' in config && config.quiet === true)) {
            console.log(`\t- block #${blockData.number.toString()}: ${blockData.transactions.length.toString()} transactions recorded.`);
        }
    }
    self.blocks++;

    if (flush && self.blocks > 0 || self.blocks >= config.bulkSize) {
        const bulk = self.bulkOps;
        self.bulkOps = [];
        self.blocks = 0;
        const {miners} = self;
        self.miners = [];

        const data = {};
        bulk.forEach((tx) => {
            data[tx.from] = {address: tx.from, blockNumber: tx.blockNumber, type: 0};
            if (tx.to) {
                data[tx.to] = {address: tx.to, blockNumber: tx.blockNumber, type: 0};
            }
        });

        miners.forEach((miner) => {
            data[miner.address] = miner;
        });

        const accounts = Object.keys(data);

        if (bulk.length === 0 && accounts.length === 0) return;

        if (config.settings.useRichList && accounts.length > 0) {
            asyncL.eachSeries(accounts, (account, eachCallback) => {
                const {blockNumber} = data[account];
                web3.eth.getCode(account, (err, code) => {
                    if (err) {
                        console.log(`ERROR: fail to getCode(${account})`);
                        return eachCallback(err);
                    }
                    if (code.length > 2) {
                        data[account].type = 1; // contract type
                    }

                    web3.eth.getBalance(account, blockNumber, (err, balance) => {
                        if (err) {
                            console.log(err);
                            console.log(`ERROR: fail to getBalance(${account})`);
                            return eachCallback(err);
                        }

                        data[account].balance = parseFloat(web3.utils.fromWei(balance, 'ether'));
                        eachCallback();
                    });
                });
            }, () => {
                let n = 0;
                accounts.forEach((account) => {
                    n++;
                    if (!('quiet' in config && config.quiet === true)) {
                        if (n <= 5) {
                            console.log(` - upsert ${account} / balance = ${data[account].balance}`);
                        } else if (n === 6) {
                            console.log(`   (...) total ${accounts.length} accounts updated.`);
                        }
                    }
                    Account.collection.update({address: account}, {$set: data[account]}, {upsert: true});
                });
            });
        }

        if (bulk.length > 0) {
            Transaction.collection.insert(bulk, (err, tx) => {
                if (typeof err !== 'undefined' && err) {
                    if (err.code === 11000) {
                        if (!('quiet' in config && config.quiet === true)) {
                            console.log(`Skip: Duplicate transaction key ${err}`);
                        }
                    } else {
                        console.log(`Error: Aborted due to error on Transaction: ${err}`);
                        process.exit(9);
                    }
                } else {
                    if (!('quiet' in config && config.quiet === true)) {
                        console.log(`* ${tx.insertedCount} transactions successfully recorded.`);
                    }
                }
            });
        }
    }
};

const listenBlocks = function (config) {
    const newBlocks = web3.eth.subscribe('newBlockHeaders', (error) => {
        if (!error) {
            return;
        }

        console.error(error);
    });
    newBlocks.on('data', (blockHeader) => {
        web3.eth.getBlock(blockHeader.hash, true, (error, blockData) => {
            if (blockHeader === null) {
                console.log('Warning: null block hash');
            } else {
                writeBlockToDB(config, blockData, true);
                writeTransactionsToDB(config, blockData, true);
            }
        });
    });
    newBlocks.on('error', console.error);
};

let syncChain = function (config, nextBlock) {
    if (web3.eth.net.isListening()) {
        if (typeof nextBlock === 'undefined') {
            prepareSync(config, (error, startBlock) => {
                if (error) {
                    console.log(`ERROR: error: ${error}`);
                    return;
                }
                syncChain(config, startBlock);
            });
            return;
        }

        if (nextBlock === null) {
            console.log('nextBlock is null');
            return;
        }
        if (nextBlock < config.startBlock) {
            writeBlockToDB(config, null, true);
            writeTransactionsToDB(config, null, true);
            console.log('*** Sync Finsihed ***');
            config.syncAll = false;
            return;
        }

        let count = config.bulkSize;
        while (nextBlock >= config.startBlock && count > 0) {
            web3.eth.getBlock(nextBlock, true, (error, blockData) => {
                if (error) {
                    console.log(`Warning (syncChain): error on getting block with hash/number: ${nextBlock}: ${error}`);
                } else if (blockData === null) {
                    console.log(`Warning: null block data received from the block with hash/number: ${nextBlock}`);
                } else {
                    writeBlockToDB(config, blockData);
                    writeTransactionsToDB(config, blockData);
                }
            });
            nextBlock--;
            count--;
        }

        setTimeout(() => {
            syncChain(config, nextBlock);
        }, 500);
    } else {
        console.log(`Error: Web3 connection time out trying to get block ${nextBlock} retrying connection now`);
        syncChain(config, nextBlock);
    }
};

const prepareSync = async (config, callback) => {
    let blockNumber = null;
    const oldBlockFind = Block.find({}, 'number').lean(true).sort('number').limit(1);
    oldBlockFind.exec(async (err, docs) => {
        if (err || !docs || docs.length < 1) {
            if (web3.eth.net.isListening()) {
                const currentBlock = await web3.eth.getBlockNumber();
                const latestBlock = config.endBlock || currentBlock || 'latest';
                if (latestBlock === 'latest') {
                    web3.eth.getBlock(latestBlock, true, (error, blockData) => {
                        if (error) {
                            console.log(`Warning (prepareSync): error on getting block with hash/number: ${latestBlock}: ${error}`);
                        } else if (blockData === null) {
                            console.log(`Warning: null block data received from the block with hash/number: ${latestBlock}`);
                        } else {
                            console.log(`Starting block number = ${blockData.number}`);
                            if ('quiet' in config && config.quiet === true) {
                                console.log('Quiet mode enabled');
                            }
                            blockNumber = blockData.number - 1;
                            callback(null, blockNumber);
                        }
                    });
                } else {
                    console.log(`Starting block number = ${latestBlock}`);
                    if ('quiet' in config && config.quiet === true) {
                        console.log('Quiet mode enabled');
                    }
                    blockNumber = latestBlock - 1;
                    callback(null, blockNumber);
                }
            } else {
                console.log('Error: Web3 connection error');
                callback(err, null);
            }
        } else {
            blockNumber = docs[0].number - 1;
            console.log(`Old block found. Starting block number = ${blockNumber}`);
            if ('quiet' in config && config.quiet === true) {
                console.log('Quiet mode enabled');
            }
            callback(null, blockNumber);
        }
    });
};

const runPatcher = async (config, startBlock, endBlock) => {
    if (!web3 || !web3.eth.net.isListening()) {
        console.log('Error: Web3 is not connected. Retrying connection shortly...');
        setTimeout(() => {
            runPatcher(config);
        }, 3000);
        return;
    }

    if (typeof startBlock === 'undefined' || typeof endBlock === 'undefined') {
        const blockFind = Block.find({}, 'number').lean(true).sort('-number').limit(1);
        blockFind.exec(async (err, docs) => {
            if (err || !docs || docs.length < 1) {
                console.log('No need to patch blocks.');
                return;
            }

            const lastMissingBlock = docs[0].number + 1;
            const currentBlock = await web3.eth.getBlockNumber();
            runPatcher(config, lastMissingBlock, currentBlock - 1);
        });
        return;
    }

    const missingBlocks = endBlock - startBlock + 1;
    if (missingBlocks > 0) {
        if (!('quiet' in config && config.quiet === true)) {
            console.log(`Patching from #${startBlock} to #${endBlock}`);
        }
        let patchBlock = startBlock;
        let count = 0;
        while (count < config.patchBlocks && patchBlock <= endBlock) {
            if (!('quiet' in config && config.quiet === true)) {
                console.log(`Patching Block: ${patchBlock}`);
            }
            web3.eth.getBlock(patchBlock, true, (error, patchData) => {
                if (error) {
                    console.log(`Warning: error on getting block with hash/number: ${patchBlock}: ${error}`);
                } else if (patchData === null) {
                    console.log(`Warning: null block data received from the block with hash/number: ${patchBlock}`);
                } else {
                    checkBlockDBExistsThenWrite(config, patchData);
                }
            });
            patchBlock++;
            count++;
        }

        writeBlockToDB(config, null, true);
        writeTransactionsToDB(config, null, true);

        setTimeout(() => {
            runPatcher(config, patchBlock, endBlock);
        }, 1000);
    } else {

        writeBlockToDB(config, null, true);
        writeTransactionsToDB(config, null, true);

        console.log('*** Block Patching Completed ***');
    }
};

let checkBlockDBExistsThenWrite = function (config, patchData, flush) {
    Block.find({number: patchData.number}, (err, b) => {
        if (!b.length) {
            writeBlockToDB(config, patchData, flush);
            writeTransactionsToDB(config, patchData, flush);
        } else if (!('quiet' in config && config.quiet === true)) {
            console.log(`Block number: ${patchData.number.toString()} already exists in DB.`);
        }
    });
};

// 10 minutes
const quoteInterval = 10 * 60 * 1000;

const getQuote = async () => {
    const options = {
        timeout: 10000,
    };
    const URL = `https://min-api.cryptocompare.com/data/price?fsym=${config.settings.symbol}&tsyms=USD`;

    try {
        const requestUSD = await fetch(URL);
        const quoteUSD = await requestUSD.json();

        quoteObject = {
            timestamp: Math.round(Date.now() / 1000),
            quoteUSD: quoteUSD.USD,
        };

        new Market(quoteObject).save((err, market, count) => {
            if (typeof err !== 'undefined' && err) {
                process.exit(9);
            } else {
                if (!('quiet' in config && config.quiet === true)) {
                    console.log('DB successfully written for market quote.');
                }
            }
        });
    } catch (error) {
        if (!('quiet' in config && config.quiet === true)) {
            console.log(error);
        }
    }
};

if (config.patch === true) {
    console.log('Checking for missing blocks');
    runPatcher(config);
}

if (process.env.NORICHLIST) {
    config.settings.useRichList = false;
}

listenBlocks(config);

if (config.syncAll === true) {
    console.log('Starting Full Sync');
    syncChain(config);
}

if (config.settings.useFiat) {
    getQuote();

    setInterval(() => {
        getQuote();
    }, quoteInterval);
}
