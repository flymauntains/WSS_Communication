require("dotenv").config();
const { ethers } = require('ethers');
const fs = require("fs");

// Configuration for the Ethereum and Binance Smart Chain node WebSocket URLs
const config = {
    BNB_NODE_WSS: process.env.BNB_WSS_URL,
    // ETH_NODE_WSS: process.env.ETH_WSS_URL,
};

// ABI files
// const ethVaultABI = require("./abis/ethVaultABI.json");
const bnbVaultABI = require("./abis/bnbVaultABI.json");
const presaleABI = require("./abis/presaleABI.json");

// WebSocket connection management constants
const EXPECTED_PONG_BACK = 15000;
const KEEP_ALIVE_CHECK_INTERVAL = 7500;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL_BASE = 1000;
const SIMULATE_DISCONNECT_INTERVAL = 30000;
const simulateDisconnect = false;

const logger = console;

// Variables to track the number of reconnection attempts
let reconnectAttempts = 0;

// Function to simulate a broken connection
function simulateBrokenConnection(provider) {
    logger.warn('Simulating broken WebSocket connection');
    provider.websocket.close();
}

// Function to start and manage a WebSocket connection
function startConnection(url, onOpen, onClose, onPong, onError) {
    const provider = new ethers.WebSocketProvider(url);
    let pingTimeout = null;
    let keepAliveInterval = null;

    function scheduleReconnection() {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            let delay = RECONNECT_INTERVAL_BASE * Math.pow(2, reconnectAttempts);
            setTimeout(() => startConnection(url, onOpen, onClose, onPong, onError), delay);
            reconnectAttempts++;
            logger.log(`Scheduled reconnection attempt ${reconnectAttempts} in ${delay} ms`);
        } else {
            logger.error('Maximum reconnection attempts reached. Aborting.');
        }
    }

    provider.websocket.on('open', () => {
        reconnectAttempts = 0;
        keepAliveInterval = setInterval(() => {
            logger.debug('Checking if the connection is alive, sending a ping');
            provider.websocket.ping();
            pingTimeout = setTimeout(() => {
                logger.error('No pong received, terminating WebSocket connection');
                provider.websocket.terminate();
            }, EXPECTED_PONG_BACK);
        }, KEEP_ALIVE_CHECK_INTERVAL);

        if (simulateDisconnect) {
            setTimeout(() => simulateBrokenConnection(provider), SIMULATE_DISCONNECT_INTERVAL);
        }
        onOpen(provider);
    });

    provider.websocket.on('close', (code, reason) => {
        logger.error(`The websocket connection was closed. Code: ${code}, Reason: ${reason}`);
        clearInterval(keepAliveInterval);
        clearTimeout(pingTimeout);
        onClose();
        scheduleReconnection();
    });

    provider.websocket.on('pong', () => {
        logger.debug('Received pong, connection is alive');
        clearTimeout(pingTimeout);
        onPong();
    });

    provider.on('error', (error) => {
        logger.error('WebSocket error:', error);
        onError();
        scheduleReconnection();
    });

    return provider;
}

// Initialize BNB and Ethereum providers
const bnbProvider = startConnection(
    config.BNB_NODE_WSS,
    () => logger.log('BNB WebSocket connection opened'),
    () => logger.log('BNB WebSocket connection closed'),
    () => logger.log('BNB WebSocket pong received'),
    () => logger.log('BNB WebSocket error')
);

// const ethProvider = startConnection(
//     config.ETH_NODE_WSS,
//     () => logger.log('Ethereum WebSocket connection opened'),
//     () => logger.log('Ethereum WebSocket connection closed'),
//     () => logger.log('Ethereum WebSocket pong received'),
//     () => logger.log('Ethereum WebSocket error')
// );

// Create wallet and contract instances
const bnbWallet = new ethers.Wallet(process.env.PRIVATE_KEY, bnbProvider);
// const ethWallet = new ethers.Wallet(process.env.PRIVATE_KEY, ethProvider);

const bnbVaultContract = new ethers.Contract(process.env.BNB_VAULT_ADDRESS, bnbVaultABI, bnbWallet);
// const ethVaultContract = new ethers.Contract(process.env.ETH_VAULT_ADDRESS, ethVaultABI, ethWallet);
const presaleContract = new ethers.Contract(process.env.PRESALE_ADDRESS, presaleABI, bnbWallet);

// Variables to store current sale dates and token balance
let currentSaleDates = { startSaleDate: null, endSaleDate: null };
let currentTokenBalance = null;

// Function to fetch sale dates from the presale contract
async function fetchSaleDatesFromPresale() {
    try {
        const startSaleDateOriginal = await presaleContract.getStartSaleDate();
        const endSaleDateOriginal = await presaleContract.getEndSaleDate();
        let startSaleDate = Number(startSaleDateOriginal);
        let endSaleDate = Number(endSaleDateOriginal);
        currentSaleDates = { startSaleDate, endSaleDate };
        logger.log("Initial Sale Dates fetched:", currentSaleDates);
        return currentSaleDates;
    } catch (error) {
        logger.error("Failed to fetch sale dates:", error);
        throw error;
    }
}

// Function to fetch token balance from the presale contract
async function fetchTokenBalance() {
    try {
        const balance = await presaleContract.getTokenBalance();
        currentTokenBalance = balance;
        logger.log("Initial Token Balance fetched:", balance.toString());
        return balance;
    } catch (error) {
        logger.error("Failed to fetch token balance:", error);
        throw error;
    }
}

// Function to update the BNB Vault with fetched sale dates
async function updateBnbVault(currentSaleDates) {
    try {
        const tx = await bnbVaultContract.updateSaleDates(
            currentSaleDates.startSaleDate,
            currentSaleDates.endSaleDate
        );
        const receipt = await tx.wait();
        logger.log(`Sale dates updated successfully in BNB Vault with hash: ${receipt.hash}`);
    } catch (error) {
        logger.error("Failed to update sale dates in BNB Vault:", error);
        throw error;
    }
}

// // Function to update the Ethereum Vault with fetched sale dates
// async function updateEthVault(currentSaleDates) {
//     try {
//         const tx = await ethVaultContract.updateSaleDates(
//             currentSaleDates.startSaleDate,
//             currentSaleDates.endSaleDate
//         );
//         const receipt = await tx.wait();
//         logger.log(`Sale dates updated successfully in Ethereum Vault with hash: ${receipt.hash}`);
//     } catch (error) {
//         logger.error("Failed to update sale dates in Ethereum Vault:", error);
//         throw error;
//     }
// }

// Function to update token balance in the BNB Vault
async function updateBnbVaultTokenBalance(currentTokenBalance) {
    try {
        if (currentTokenBalance === null) {
            throw new Error("No token balance to update.");
        }
        const tx = await bnbVaultContract.updateTokenBalance(currentTokenBalance);
        const receipt = await tx.wait();
        logger.log(`Token balance updated successfully in BNB Vault with hash: ${receipt.hash}`);
    } catch (error) {
        logger.error("Failed to update token balance in BNB Vault:", error);
        throw error;
    }
}

// // Function to update token balance in the Ethereum Vault
// async function updateEthVaultTokenBalance(currentTokenBalance) {
//     try {
//         if (currentTokenBalance === null) {
//             throw new Error("No token balance to update.");
//         }
//         const tx = await ethVaultContract.updateTokenBalance(currentTokenBalance);
//         const receipt = await tx.wait();
//         logger.log(`Token balance updated successfully in Ethereum Vault with hash: ${receipt.hash}`);
//     } catch (error) {
//         logger.error("Failed to update token balance in Ethereum Vault:", error);
//         throw error;
//     }
// }

// Listen for updates and handle events
function listenForUpdates() {
    presaleContract.on("SaleDateUpdated", async (startSaleDate, endSaleDate, event) => {
        logger.log("SaleDateUpdated event triggered:", {
            startSaleDate: startSaleDate.toString(),
            endSaleDate: endSaleDate.toString(),
            data: event,
        });
        if (currentSaleDates.startSaleDate !== startSaleDate || currentSaleDates.endSaleDate !== endSaleDate) {
            currentSaleDates = { startSaleDate, endSaleDate };
            await updateBnbVault(currentSaleDates);
            // await updateEthVault(currentSaleDates);
        }
    });

    presaleContract.on("TokenBalanceUpdated", async (newBalance, event) => {
        logger.log("TokenBalanceUpdated event triggered:", {
            newBalance: newBalance.toString(),
            data: event,
        });
        currentTokenBalance = newBalance;
        await updateBnbVaultTokenBalance(currentTokenBalance);
        // await updateEthVaultTokenBalance(currentTokenBalance);
    });

    bnbVaultContract.on("TokenPurchase", async (buyer, amount, value, chainId, event) => {
        logger.log("TokenPurchase event triggered on BNB:", {
            buyer: buyer,
            amount: amount.toString(),
            value: value.toString(),
            chainId: chainId.toString(),
            data: event,
        });
        await handleTokenPurchase(buyer, amount, value, chainId);
    });

    // ethVaultContract.on("TokenPurchase", async (buyer, amount, value, chainId, event) => {
    //     logger.log("TokenPurchase event triggered on Ethereum:", {
    //         buyer: buyer,
    //         amount: amount.toString(),
    //         value: value.toString(),
    //         chainId: chainId.toString(),
    //         data: event,
    //     });
    //     await handleTokenPurchase(buyer, amount, value, chainId);
    // });
}

// Handle token purchases
async function handleTokenPurchase(buyer, amount, value, chainId) {
    logger.log(`Processing purchase for buyer ${buyer} with amount ${amount.toString()} and value ${value.toString()} on chain ${chainId.toString()}.`);
    try {
        if (amount <= 0) {
            throw new Error("Amount must be greater than 0");
        }
        const tx = await presaleContract.handleTokenPurchase(buyer, amount);
        const receipt = await tx.wait();
        logger.log(`handleTokenPurchase executed successfully with hash: ${receipt.hash}`);
        logger.log(`Tokens sold to ${buyer} for amount: ${amount.toString()}`);
    } catch (error) {
        logger.error("Failed to handle token purchase:", error);
        throw error;
    }
}

// Main function to initialize and run the backend logic
const main = async () => {
    try {
        await fetchSaleDatesFromPresale();
        await fetchTokenBalance();

        logger.log("Fetched sale dates:", currentSaleDates);

        await updateBnbVault(currentSaleDates);
        // await updateEthVault(currentSaleDates);

        await updateBnbVaultTokenBalance(currentTokenBalance);
        // await updateEthVaultTokenBalance(currentTokenBalance);

        listenForUpdates();
    } catch (error) {
        logger.error("Error:", error);
    }
};

main();
