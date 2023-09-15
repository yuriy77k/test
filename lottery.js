//console.log('start');
const Web3 = require('web3');
//require('dotenv').config({ path: '/home/v/vizberu/js/.env' }); // if use .env file for environment variables: config({ path: '/path_to_env/.env' });
const TelegramBot = require('node-telegram-bot-api');
const {RandomNumberGenerator_ABI, SoyLottery_ABI} = require('./abi.js');

// Callisto test net
//const SoyLottery_addr = "0xefBf55Af146093738982Fe25e69fE966F26670de";
//const RandomNumberGenerator_addr = "0x09D8B4A17edd82CA0681409329A31DC04B74bae2";
//const provider = "https://testnet-rpc.callisto.network"; // CLO test net
// Callisto Main net
const SoyLottery_addr = "0x56a455a29317b4813350221F07Cc1A7d7eF5142B";
const RandomNumberGenerator_addr = "0x9BfA10ec7cBDfa029692c95E493f2fc1BdCb25af";
const provider =  "https://rpc.callisto.network/"; // CLO main net


const pk = process.env.SYSTEM_PK;  // Private key should be hidden
const chatId = process.env.CHAT_ID; // telegram chat ID where to send message
const BotToken = process.env.BOT_TOKEN; // telegram bot token 
console.log("ChatID: ",chatId); // check if is settings is loaded
return;

const lottery = {
    priceTicketInSoy: "10000000000000000000", //10 SOY
    discountDivisor: 1980, // 5% discount when buy 100 tickets
    rewardsBreakdown: [1111, 2777, 6112, 0, 0, 0], // 11.11% of rewards to 1 number, 27.77% - to 2 numbers, 61.12% - to 3 numbers
    treasuryFee: 1000, // 10% of collected money go to treasury (or burn), the rest go to rewards pool
    align : 86400, // 24 hours. Lottery end time align to this value. I.e. if align = 86400 then end time will be next 00:00:00 UTC
    offset: 9*3600 - 60, // (+9:00 hours - 60 seconds) to align time
    duration: 7, // duration in days
    autoInjection: 1, // 1 - rewards that were not winned will be injected to next lottery round; 0 - unused money will go to treasury (or burn)
}

const web3 = new Web3(provider);
const acc = web3.eth.accounts.privateKeyToAccount(pk);
web3.eth.accounts.wallet.add(acc);
const SoyLottery = new web3.eth.Contract(SoyLottery_ABI, SoyLottery_addr);
const RandomNumberGenerator = new web3.eth.Contract(RandomNumberGenerator_ABI, RandomNumberGenerator_addr);
var CurrentLotteryId;

async function main() {
    var currentTime = Math.floor(Date.now() / 1000);
    try {
        CurrentLotteryId = await SoyLottery.methods.viewCurrentLotteryId().call();
        console.log("CurrentLotteryId: ",CurrentLotteryId);
        sendMessageAndExit("CurrentLotteryId: " + CurrentLotteryId);
        return;
        var LotteryData = await SoyLottery.methods.viewLottery(CurrentLotteryId).call();
        if (LotteryData.status == 1 && LotteryData.endTime < currentTime) {
            console.log("close lottery");
            var gas_limit = await SoyLottery.methods.closeLottery(CurrentLotteryId).estimateGas({from: acc.address});
            var params = {from: acc.address, value: 0, gas: parseInt(gas_limit)+20000,};
            await SoyLottery.methods.closeLottery(CurrentLotteryId).send(params);

            var rnd = genSecret(LotteryData.endTime); //web3.utils.randomHex(32);
            //console.log("random: ", rnd);
            gas_limit = await RandomNumberGenerator.methods.commitSecret(web3.utils.keccak256(rnd)).estimateGas({from: acc.address});
            params = {from: acc.address, value: 0, gas: parseInt(gas_limit)+20000,};
            var tx = await RandomNumberGenerator.methods.commitSecret(web3.utils.keccak256(rnd)).send(params);
            //console.log(tx);
            // should wait 1 block
            setTimeout(() => {
                delayedTransaction(tx.blockNumber, rnd);
              }, 10000);
        }
        else if (LotteryData.status == 2) {
            // random number generation is not complete
            console.log("random number generation is not complete. try again");
            var rnd = genSecret(LotteryData.endTime);
            // should wait 1 block
            delayedTransaction(1, rnd);
        } else if (LotteryData.status == 3) {
            await startLottery(currentTime);
        }
    
    }
    catch (e) {
        console.log("Error: ", e.toString());
        sendMessageAndExit(e.toString());
    }
}

async function startLottery(currentTime) {
    try 
    {
        console.log("start new lottery at: ", currentTime);
        var endTime = (Math.trunc(currentTime / lottery.align) * lottery.align + lottery.offset) + (lottery.align * lottery.duration);
        //endTime = 1692953960;
        //if (endTime - currentTime < 3600) endTime += lottery.align;
        var gas_limit = await SoyLottery.methods.startLottery(endTime, lottery.priceTicketInSoy, lottery.discountDivisor, lottery.rewardsBreakdown, lottery.treasuryFee).estimateGas({from: acc.address});
        var params = {from: acc.address, value: 0, gas: parseInt(gas_limit)+20000,};
        var tx = await SoyLottery.methods.startLottery(endTime, lottery.priceTicketInSoy, lottery.discountDivisor, lottery.rewardsBreakdown, lottery.treasuryFee).send(params);
        console.log(tx);
        var bal = await web3.eth.getBalance(acc.address);
        // send message if operator wallet has less than 5 CLO
        if (parseFloat(web3.utils.fromWei(bal)) < 5) sendMessageAndExit("Low ballance of Lottery Operator "+acc.address);
        sendMessageAndExit("start new lottery at: "+ currentTime);
    }
    catch (e) {
        console.log("Error: ", e.toString());
        sendMessageAndExit(e.toString());
    }
}

async function delayedTransaction(block, rnd) {
    try 
    {
        var lastBlock = await web3.eth.getBlockNumber();
        console.log("block: "+block+" lastBlock: "+lastBlock);
        if (block < lastBlock) {
                // should wait 1 block
                var currentTime = Math.floor(Date.now() / 1000);

                var gas_limit = await RandomNumberGenerator.methods.revealSecret(CurrentLotteryId, rnd).estimateGas({from: acc.address});
                var params = {from: acc.address, value: 0, gas: parseInt(gas_limit)+20000,};
                await RandomNumberGenerator.methods.revealSecret(CurrentLotteryId, rnd).send(params);

                console.log("drawFinalNumberAndMakeLotteryClaimable");
                gas_limit = await SoyLottery.methods.drawFinalNumberAndMakeLotteryClaimable(CurrentLotteryId, lottery.autoInjection).estimateGas({from: acc.address});
                params = {from: acc.address, value: 0, gas: parseInt(gas_limit)+20000,};
                await SoyLottery.methods.drawFinalNumberAndMakeLotteryClaimable(CurrentLotteryId, lottery.autoInjection).send(params);
                await startLottery(currentTime);        
        } 
        else 
        {
            setTimeout(() => {
                delayedTransaction(block, rnd);
            }, 10000);
        }
    }
    catch (e) {
        console.log("Error: ", e.toString());
        sendMessageAndExit(e.toString());
    }
}

async function sendMessageAndExit(msg) {
    const bot = new TelegramBot(BotToken, {polling: true});

    await bot.sendMessage(chatId, msg);
    process.exit();
}

function genSecret(seed) {
    var s = web3.utils.keccak256(pk);
    var s1 = web3.utils.keccak256(seed.toString()+s);
    return web3.utils.keccak256("Callisto"+s+s1);
}

main();
