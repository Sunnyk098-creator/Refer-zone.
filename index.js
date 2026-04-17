import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction } from 'firebase/database';
import axios from 'axios';

// --- CONFIGURATION ---
const BOT_TOKEN = '8253316202:AAEn-BHm0hjY4j3Pop_azIlPsW4dO1gdU28'; // Updated Token
const ADMIN_ID = 8522410574; // Master Admin

const BOT_NAME = "Virtual Pocket Cash 💸🚀";
const BOT_USERNAME = "VirtualPocketBot";

const firebaseConfig = {
    apiKey: "AIzaSyCGUOPsQ4ALJy05iyIuBLbNsu-2gARnDrw",
    authDomain: "refer-zone-b9e48.firebaseapp.com",
    databaseURL: "https://refer-zone-b9e48-default-rtdb.firebaseio.com",
    projectId: "refer-zone-b9e48",
    storageBucket: "refer-zone-b9e48.firebasestorage.app",
    messagingSenderId: "1024531611430",
    appId: "1:1024531611430:web:bf52da491c3932b93e4be7"
};

// --- INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- MEMORY STATE ---
const userStates = {};

// --- MENUS ---
const USER_MENU = {
    reply_markup: {
        keyboard: [
            ['Balance', 'Refer earn'],
            ['Bonus', 'Withdraw'],
            ['Link wallet']
        ],
        resize_keyboard: true
    }
};

const ADMIN_MENU = {
    reply_markup: {
        keyboard: [
            ['🤖 Bot ON/OFF', '💸 Withdraw ON/OFF'],
            ['📢 Add Channel', '❌ Remove Channel'], 
            ['⚙️ Set API Gateway', '👨‍💻 Manage Admins'],
            ['⬇️ Min Withdraw', '⬆️ Max Withdraw'],
            ['💰 Refer Amount', '📉 Min Refer'],
            ['📊 Stats', '🏆 Leaderboard'],
            ['🚫 Ban User', '✅ Unban User'],
            ['💳 Reset Balance'],
            ['➕ Add Amount', '➖ Deduct Amount']
        ],
        resize_keyboard: true
    }
};

// --- UTILS ---
async function checkIsAdmin(id) {
    if (id === ADMIN_ID) return true;
    const snap = await get(ref(db, `admins/${id}`));
    return snap.exists() && snap.val() === true;
}

async function getSettings() {
    const snap = await get(ref(db, 'settings'));
    const defaultSettings = {
        botStatus: true,
        withdrawStatus: true,
        minWithdraw: 10,
        maxWithdraw: 100,
        referAmount: 5,
        minRefer: 1,
        bonusAmount: 1
    };
    if (!snap.exists()) {
        await set(ref(db, 'settings'), defaultSettings);
        return defaultSettings;
    }
    return { ...defaultSettings, ...snap.val() };
}

// Fetch all active gateways
async function getGateways() {
    const snap = await get(ref(db, 'gateways'));
    return snap.exists() ? snap.val() : {};
}

async function checkChannels(userId) {
    const snap = await get(ref(db, 'channels'));
    if (!snap.exists()) return { allJoined: true, channels: [] };
    
    const channels = Object.values(snap.val());
    let allJoined = true;
    let pending = [];

    for (let ch of channels) {
        try {
            const member = await bot.getChatMember(ch, userId);
            if (!['member', 'administrator', 'creator'].includes(member.status)) {
                allJoined = false;
                pending.push(ch);
            }
        } catch (e) {
            allJoined = false;
            pending.push(ch);
        }
    }
    return { allJoined, channels: pending };
}

function generateJoinKeyboard(channels) {
    const keyboard = channels.map(ch => [{ text: `📢 Join ${ch}`, url: `https://t.me/${ch.replace('@', '')}` }]);
    keyboard.push([{ text: '✅ Verify Join', callback_data: 'verify_join' }]);
    return { reply_markup: { inline_keyboard: keyboard } };
}

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text) return;

    const isAdminUser = await checkIsAdmin(userId);

    // --- Dev Commands ---
    if (text === '/dev') return bot.sendMessage(chatId, "Made by [Alpha](https://t.me/ALPHAxBMW)", { parse_mode: 'Markdown', disable_web_page_preview: true });
    if (text === '/build') return bot.sendMessage(chatId, "Made by [Sunny](https://t.me/sunnybotmaker)", { parse_mode: 'Markdown', disable_web_page_preview: true });

    const settings = await getSettings();

    // Check Ban
    const banSnap = await get(ref(db, `banned/${userId}`));
    if (banSnap.exists()) return bot.sendMessage(chatId, "🚫 You are banned from using this bot.");

    // Check Bot Status
    if (!settings.botStatus && !isAdminUser) {
        return bot.sendMessage(chatId, `🛠 ${BOT_NAME} is currently under maintenance.`);
    }

    if (text === '/skadmin' && isAdminUser) {
        userStates[userId] = null;
        return bot.sendMessage(chatId, "👨‍💻 Welcome to the Admin Panel!", ADMIN_MENU);
    }

    // --- FETCH USER DATA EARLY ---
    const userRef = ref(db, `users/${userId}`);
    const userSnap = await get(userRef);
    let userData = userSnap.exists() ? userSnap.val() : null;

    // --- START COMMAND ---
    if (text.startsWith('/start')) {
        const referredByMatch = text.split(' ')[1];
        let referredBy = null;
        if (referredByMatch && Number(referredByMatch) !== userId) {
            referredBy = Number(referredByMatch);
        }

        if (!userData) {
            userData = {
                balance: 0,
                referrals: 0,
                referredBy: referredBy || false,
                verified: false,
                rewardGiven: false,
                wallet: null 
            };
            await set(userRef, userData);
        }

        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            return bot.sendMessage(chatId, `⚠️ *To use ${BOT_NAME}, you MUST join our channels first!*`, Object.assign({ parse_mode: 'Markdown' }, generateJoinKeyboard(channelStatus.channels)));
        } else {
            return promptDeviceVerification(chatId, userId);
        }
    }

    if (!userData) return;

    // Verification check for all other commands
    if (userData.verified === false) {
        return bot.sendMessage(chatId, "❌ You must verify your device first. Type /start to verify.");
    }

    // ==========================================
    // STATE HANDLING (Waiting for User/Admin Input)
    // ==========================================
    if (userStates[userId]) {
        const state = userStates[userId].step;
        const val = text.trim();

        // 1. User State: LINK_WALLET
        if (state === 'LINK_WALLET') {
            if (!/^\d{10}$/.test(val)) {
                return bot.sendMessage(chatId, "❌ Invalid format. Please enter exactly 10 digits for your wallet number:");
            }
            await update(userRef, { wallet: val });
            delete userStates[userId];
            return bot.sendMessage(chatId, `✅ Wallet number ${val} linked successfully! You can now withdraw easily.`, USER_MENU);
        }

        // 2. User State: WITHDRAW_AMOUNT (Amount Entered -> Choose Gateway)
        if (state === 'WITHDRAW_AMOUNT') {
            const amt = Number(val);
            
            if (isNaN(amt) || amt < settings.minWithdraw || amt > settings.maxWithdraw || amt > userData.balance) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ Invalid amount or insufficient balance. Try again via 'Withdraw'.", USER_MENU);
            }

            // Fetch gateways
            const gws = await getGateways();
            const gwKeys = Object.keys(gws);
            if (gwKeys.length === 0) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ No payment gateways available right now. Please contact admin.");
            }

            // Create inline keyboard for gateways
            let inlineKeyboard = [];
            for (let key in gws) {
                try {
                    const urlObj = new URL(gws[key]);
                    let domain = urlObj.hostname.replace('www.', ''); // ex: virtual-pocket.vercel.app
                    let nameParts = domain.split('.')[0].split('-');
                    let name = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); // ex: Virtual Pocket
                    
                    inlineKeyboard.push([{ text: `🏦 ${name}`, callback_data: `pay_${amt}_${key}` }]);
                } catch(e) {}
            }

            bot.sendMessage(chatId, `💰 *Amount:* ₹${amt}\n\n👇 *Choose Gateway for Withdrawal:*`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
            delete userStates[userId]; // Clear state
            return;
        }

        // 3. Admin States
        if (isAdminUser) {
            let adminStateMatched = true;
            try {
                if (state === 'ADD_CHANNEL') {
                    let channelId = val;
                    if (channelId.includes('t.me/')) {
                        const parts = channelId.split('t.me/');
                        channelId = '@' + parts[1].split('/')[0].replace('+', '');
                    } else if (!channelId.startsWith('@') && !channelId.startsWith('-100')) {
                        channelId = '@' + channelId;
                    }
                    try {
                        const botInfo = await bot.getMe();
                        const memberInfo = await bot.getChatMember(channelId, botInfo.id);
                        if (!['administrator', 'creator'].includes(memberInfo.status)) {
                            bot.sendMessage(chatId, `❌ Bot is not admin in ${channelId}`, ADMIN_MENU);
                        } else {
                            await set(ref(db, `channels/${Date.now()}`), channelId);
                            bot.sendMessage(chatId, `✅ Channel ${channelId} added successfully.`, ADMIN_MENU);
                        }
                    } catch (e) {
                        bot.sendMessage(chatId, `❌ Bot is not admin in ${channelId} or the channel is invalid/private.`, ADMIN_MENU);
                    }
                } else if (state === 'ADD_GATEWAY') {
                    if (!val.startsWith('http')) {
                        bot.sendMessage(chatId, "❌ Invalid URL format. Must start with http or https.", ADMIN_MENU);
                    } else {
                        await set(ref(db, `gateways/${Date.now()}`), val);
                        bot.sendMessage(chatId, "✅ Gateway added successfully.", ADMIN_MENU);
                    }
                } else if (state === 'MIN_WITHDRAW') {
                    await update(ref(db, 'settings'), { minWithdraw: Number(val) });
                    bot.sendMessage(chatId, `✅ Min Withdraw set to ${val}.`, ADMIN_MENU);
                } else if (state === 'MAX_WITHDRAW') {
                    await update(ref(db, 'settings'), { maxWithdraw: Number(val) });
                    bot.sendMessage(chatId, `✅ Max Withdraw set to ${val}.`, ADMIN_MENU);
                } else if (state === 'REFER_AMOUNT') {
                    await update(ref(db, 'settings'), { referAmount: Number(val) });
                    bot.sendMessage(chatId, `✅ Refer Amount set to ${val}.`, ADMIN_MENU);
                } else if (state === 'MIN_REFER') {
                    await update(ref(db, 'settings'), { minRefer: Number(val) });
                    bot.sendMessage(chatId, `✅ Min Refer set to ${val}.`, ADMIN_MENU);
                } else if (state === 'BAN_USER') {
                    await set(ref(db, `banned/${val}`), true);
                    bot.sendMessage(chatId, `🚫 User ${val} has been manually banned.`, ADMIN_MENU);
                } else if (state === 'UNBAN_USER') {
                    await set(ref(db, `banned/${val}`), null);
                    bot.sendMessage(chatId, `✅ User ${val} has been unbanned.`, ADMIN_MENU);
                } else if (state === 'ADD_AMOUNT') {
                    const parts = val.split(' ');
                    if (parts.length === 2) {
                        const trgId = parts[0];
                        const amt = Number(parts[1]);
                        const refDb = ref(db, `users/${trgId}/balance`);
                        runTransaction(refDb, (current) => (current || 0) + amt);
                        bot.sendMessage(chatId, `✅ Added ${amt} to ${trgId}.`, ADMIN_MENU);
                    } else bot.sendMessage(chatId, "❌ Format: USERID AMOUNT");
                } else if (state === 'DEDUCT_AMOUNT') {
                    const parts = val.split(' ');
                    if (parts.length === 2) {
                        const trgId = parts[0];
                        const amt = Number(parts[1]);
                        const refDb = ref(db, `users/${trgId}/balance`);
                        runTransaction(refDb, (current) => ((current || 0) - amt >= 0 ? (current || 0) - amt : 0));
                        bot.sendMessage(chatId, `✅ Deducted ${amt} from ${trgId}.`, ADMIN_MENU);
                    } else bot.sendMessage(chatId, "❌ Format: USERID AMOUNT");
                } else if (state === 'ADD_ADMIN_STATE') {
                    const targetId = Number(val);
                    if (isNaN(targetId)) return bot.sendMessage(chatId, "❌ Invalid User ID.", ADMIN_MENU);
                    await set(ref(db, `admins/${targetId}`), true);
                    bot.sendMessage(chatId, `✅ User ${targetId} is now an Admin.`, ADMIN_MENU);
                } else if (state === 'REMOVE_ADMIN_STATE') {
                    const targetId = Number(val);
                    if (isNaN(targetId)) return bot.sendMessage(chatId, "❌ Invalid User ID.", ADMIN_MENU);
                    if (targetId === ADMIN_ID) return bot.sendMessage(chatId, "❌ Cannot remove the Master Admin.", ADMIN_MENU);
                    await set(ref(db, `admins/${targetId}`), null);
                    bot.sendMessage(chatId, `✅ User ${targetId} is no longer an Admin.`, ADMIN_MENU);
                } else {
                    adminStateMatched = false;
                }
            } catch (err) {
                bot.sendMessage(chatId, "❌ An error occurred processing your request.");
            }

            if (adminStateMatched) {
                delete userStates[userId];
                return; // Admin state was handled, don't go to user buttons
            }
        }
    }

    // ==========================================
    // USER MENU BUTTONS
    // ==========================================
    if (text === 'Balance') {
        return bot.sendMessage(chatId, `💰 Balance: ₹${userData.balance}\n\n🎉 Invite friends, Earn Money & Withdraw To Your Wallet Instantly`);
    }

    if (text === 'Refer earn') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=${userId}`;
        const msg = `🎉 Invite Friends & Earn!\n\n💰 Get ₹${settings.referAmount} for each successful invite.\n\n🔗 Your Invite Link: \n${refLink}\n\n📢 Invite friends, grow your community, and earn bonuses with every successful referral. Start now!`;
        return bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: [[{ text: "🏆 View Top Leaderboard 🌟", callback_data: "show_user_leaderboard" }]] }
        });
    }

    if (text === 'Bonus') {
        const lastBonus = userData.lastBonus || 0;
        const now = Date.now();
        if (now - lastBonus > 86400000) {
            await update(userRef, { balance: (userData.balance || 0) + settings.bonusAmount, lastBonus: now });
            return bot.sendMessage(chatId, `🎁 You received a daily bonus of ₹${settings.bonusAmount}!`);
        } else {
            return bot.sendMessage(chatId, "❌ You already claimed your bonus today. Try again tomorrow.");
        }
    }

    if (text === 'Link wallet') {
        userStates[userId] = { step: 'LINK_WALLET' };
        
        const gws = await getGateways();
        let msg = `💳 Send Wallet Registered Number\n\n`;
        let addedDomains = new Set();
        
        for (let key in gws) {
            try {
                const urlObj = new URL(gws[key]);
                let domain = urlObj.origin; 
                if (!addedDomains.has(domain)) {
                    msg += `🔗 Link : ${domain}\n`;
                    addedDomains.add(domain);
                }
            } catch(e) {}
        }

        if(addedDomains.size === 0) {
            msg += `🔗 Link : No gateways available.`;
        }

        return bot.sendMessage(chatId, msg, { disable_web_page_preview: true });
    }

    if (text === 'Withdraw') {
        if (!settings.withdrawStatus) return bot.sendMessage(chatId, "❌ Withdrawals are temporarily disabled.");
        if (userData.referrals < settings.minRefer) return bot.sendMessage(chatId, `❌ You need at least ${settings.minRefer} referrals to withdraw.`);
        if (userData.balance < settings.minWithdraw) return bot.sendMessage(chatId, `❌ Minimum withdrawal is ₹${settings.minWithdraw}. Your balance: ₹${userData.balance}`);
        
        if (!userData.wallet) {
            return bot.sendMessage(chatId, "❌ You haven't linked a wallet yet.\n\nPlease click on 'Link wallet' from the menu first to save your number.", USER_MENU);
        }

        userStates[userId] = { step: 'WITHDRAW_AMOUNT' };
        return bot.sendMessage(chatId, `📱 Withdraw to: ${userData.wallet}\n\n💰 Send Total Amount To Withdraw\n\n(Min: ₹${settings.minWithdraw}, Max: ₹${settings.maxWithdraw}, Your Balance: ₹${userData.balance})`);
    }

    // ==========================================
    // ADMIN MENU BUTTONS
    // ==========================================
    if (isAdminUser) {
        if (text === '🤖 Bot ON/OFF') {
            const newState = !settings.botStatus;
            await update(ref(db, 'settings'), { botStatus: newState });
            return bot.sendMessage(chatId, `🤖 Bot is now ${newState ? 'ON' : 'OFF'}`);
        }
        if (text === '💸 Withdraw ON/OFF') {
            const newState = !settings.withdrawStatus;
            await update(ref(db, 'settings'), { withdrawStatus: newState });
            return bot.sendMessage(chatId, `💸 Withdraw is now ${newState ? 'ON' : 'OFF'}`);
        }
        if (text === '📢 Add Channel') {
            userStates[userId] = { step: 'ADD_CHANNEL' };
            return bot.sendMessage(chatId, "Send the channel username (e.g., @mychannel) or Invite Link:");
        }
        if (text === '❌ Remove Channel') {
            const snap = await get(ref(db, 'channels'));
            if (!snap.exists() || Object.keys(snap.val()).length === 0) return bot.sendMessage(chatId, "❌ No channels have been added yet.");
            const channels = snap.val();
            const inlineKeyboard = [];
            for (const [key, ch] of Object.entries(channels)) {
                inlineKeyboard.push([{ text: `📢 ${ch}`, callback_data: 'ignore' }, { text: '❌ Remove', callback_data: `remove_ch_${key}` }]);
            }
            return bot.sendMessage(chatId, "Select a channel to remove:", { reply_markup: { inline_keyboard: inlineKeyboard } });
        }
        if (text === '👨‍💻 Manage Admins') {
            return bot.sendMessage(chatId, "👨‍💻 *Manage Admins*\n\nSelect an action below:", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "➕ Add Admin", callback_data: "add_admin_btn" }, { text: "➖ Remove Admin", callback_data: "rem_admin_btn" }], [{ text: "📜 Admin List", callback_data: "list_admin_btn" }]] }
            });
        }
        // Updated Set API Gateway logic
        if (text === '⚙️ Set API Gateway') {
            return bot.sendMessage(chatId, "⚙️ *API Gateway Management*\n\nChoose an option:", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "👁 Show Active Gateways", callback_data: "show_gateways" }],
                        [{ text: "➕ Add Gateway", callback_data: "add_gateway_btn" }]
                    ]
                }
            });
        }
        if (text === '⬇️ Min Withdraw') {
            userStates[userId] = { step: 'MIN_WITHDRAW' };
            return bot.sendMessage(chatId, "Send new Minimum Withdraw amount:");
        }
        if (text === '⬆️ Max Withdraw') {
            userStates[userId] = { step: 'MAX_WITHDRAW' };
            return bot.sendMessage(chatId, "Send new Maximum Withdraw amount:");
        }
        if (text === '💰 Refer Amount') {
            userStates[userId] = { step: 'REFER_AMOUNT' };
            return bot.sendMessage(chatId, "Send new Refer Reward amount:");
        }
        if (text === '📉 Min Refer') {
            userStates[userId] = { step: 'MIN_REFER' };
            return bot.sendMessage(chatId, "Send Minimum Referrals required to withdraw:");
        }
        if (text === '🚫 Ban User') {
            userStates[userId] = { step: 'BAN_USER' };
            return bot.sendMessage(chatId, "Send User ID to Ban:");
        }
        if (text === '✅ Unban User') {
            userStates[userId] = { step: 'UNBAN_USER' };
            return bot.sendMessage(chatId, "Send User ID to Unban:");
        }
        if (text === '➕ Add Amount') {
            userStates[userId] = { step: 'ADD_AMOUNT' };
            return bot.sendMessage(chatId, "Send User ID and Amount separated by space:");
        }
        if (text === '➖ Deduct Amount') {
            userStates[userId] = { step: 'DEDUCT_AMOUNT' };
            return bot.sendMessage(chatId, "Send User ID and Amount separated by space:");
        }
        if (text === '📊 Stats') {
            const usersSnap = await get(ref(db, 'users'));
            let total = 0, success = 0, failed = 0, pending = 0;
            if (usersSnap.exists()) {
                const users = usersSnap.val();
                total = Object.keys(users).length;
                for (let uid in users) {
                    const status = users[uid].verified;
                    if (status === true) success++;
                    else if (status === 'failed') failed++;
                    else pending++;
                }
            }
            return bot.sendMessage(chatId, `📊 *Detailed User Statistics*\n\n👥 *Total Users:* ${total}\n✅ *Verification Successful:* ${success}\n❌ *Verification Failed:* ${failed}\n⏳ *Verification Pending:* ${pending}`, { parse_mode: 'Markdown' });
        }
        if (text === '🏆 Leaderboard') {
            const usersSnap = await get(ref(db, 'users'));
            if (!usersSnap.exists()) return bot.sendMessage(chatId, "❌ No users found in database.");
            const users = usersSnap.val();
            let userArray = [];
            for (let uid in users) userArray.push({ userId: uid, referrals: users[uid].referrals || 0 });
            userArray.sort((a, b) => b.referrals - a.referrals);
            let lbMsg = "🏆 *Top 10 Referrers Leaderboard* 🏆\n\n";
            userArray.slice(0, 10).forEach((user, index) => {
                lbMsg += `${index + 1}. [${user.userId}](tg://user?id=${user.userId}) ➖ ${user.referrals} Referrals\n`;
            });
            return bot.sendMessage(chatId, lbMsg, { parse_mode: 'Markdown' });
        }
        if (text === '💳 Reset Balance') {
            return bot.sendMessage(chatId, "Feature in development.");
        }
    }
});

// --- CALLBACK QUERY HANDLER ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id);

    const isAdminUser = await checkIsAdmin(userId);

    // =====================================
    // PAYMENT PROCESSING (Choosing Gateway)
    // =====================================
    if (data.startsWith('pay_')) {
        const parts = data.split('_');
        const amt = Number(parts[1]);
        const gwKey = parts.slice(2).join('_');

        // Verify user and balance
        const userRef = ref(db, `users/${userId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) return;
        const uData = userSnap.val();

        if (uData.balance < amt) {
            bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
            return bot.sendMessage(chatId, "❌ Insufficient balance. Transaction cancelled.");
        }

        // Delete inline keyboard to prevent double clicks
        bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});

        const gwSnap = await get(ref(db, `gateways/${gwKey}`));
        if (!gwSnap.exists()) return bot.sendMessage(chatId, "❌ This gateway is no longer available.");
        const apiUrl = gwSnap.val();

        // Deduct Balance before processing API
        await update(userRef, { balance: uData.balance - amt });
        bot.sendMessage(chatId, "⏳ Processing withdrawal...", USER_MENU);

        const walletNumber = uData.wallet;
        try {
            const finalUrl = apiUrl.replace(/{number}/g, walletNumber).replace(/{wallet}/g, walletNumber).replace(/{amount}/g, amt);
            console.log("Calling API:", finalUrl); // Server console log for debugging

            const response = await axios.get(finalUrl);
            
            // Checking if the API actually succeeded
            if (response.status === 200) {
                bot.sendMessage(chatId, `💸 Your Withdrawal Paid Successfully !! 💸\n\n🎉 Please Check Your Wallet 🎉`);
                const alertMsg = `🚨 *New Withdrawal Successful*\n\n👤 *User ID:* \`${userId}\`\n💰 *Amount:* ₹${amt}\n💳 *Wallet:* \`${walletNumber}\`\n✅ *Status:* Paid via API`;
                bot.sendMessage(ADMIN_ID, alertMsg, { parse_mode: 'Markdown' });
            } else {
                throw new Error(`API Returned non-200 Status: ${response.status}`);
            }
        } catch (e) {
            // Capture the exact error from API
            const errorMsg = e.response && e.response.data 
                ? JSON.stringify(e.response.data) 
                : e.message;
            
            console.error(`Withdrawal Failed for ${userId}:`, errorMsg);

            // Refund on failure
            const freshUser = (await get(userRef)).val();
            await update(userRef, { balance: freshUser.balance + amt });
            bot.sendMessage(chatId, "❌ Withdrawal failed via API. Balance refunded.");
            
            // Notify Admin with exact error so you can fix the gateway
            const adminFailMsg = `⚠️ *Withdrawal Failed*\n\n👤 *User:* \`${userId}\`\n💰 *Amount:* ₹${amt}\n💳 *Wallet:* \`${walletNumber}\`\n❌ *Error:* \`${errorMsg.substring(0, 100)}\``;
            bot.sendMessage(ADMIN_ID, adminFailMsg, { parse_mode: 'Markdown' });
        }
        return;
    }

    // =====================================
    // GATEWAY MANAGEMENT (ADMIN)
    // =====================================
    if (data === 'show_gateways' && isAdminUser) {
        const gws = await getGateways();
        if (Object.keys(gws).length === 0) return bot.sendMessage(chatId, "❌ No active gateways found.");
        for (let key in gws) {
            bot.sendMessage(chatId, `🌐 *API URL:*\n\`${gws[key]}\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "❌ Remove", callback_data: `remove_gw_${key}` }]] },
                disable_web_page_preview: true
            });
        }
    }
    if (data === 'add_gateway_btn' && isAdminUser) {
        userStates[userId] = { step: 'ADD_GATEWAY' };
        bot.sendMessage(chatId, "Send the API URL.\n\n*Format Example:*\n`https://site.com/api.php?paytm={wallet}&amount={amount}&comment=Payout`", { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    if (data.startsWith('remove_gw_') && isAdminUser) {
        const gwKey = data.replace('remove_gw_', '');
        await set(ref(db, `gateways/${gwKey}`), null);
        bot.editMessageText("✅ Gateway successfully removed.", { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    }

    // =====================================
    // EXISTING CALLBACKS
    // =====================================
    if (data === 'show_user_leaderboard') {
        const usersSnap = await get(ref(db, 'users'));
        if (!usersSnap.exists()) return bot.sendMessage(chatId, "❌ Leaderboard is empty.");
        const users = usersSnap.val();
        let userArray = [];
        for (let uid in users) userArray.push({ userId: uid, referrals: users[uid].referrals || 0 });
        userArray.sort((a, b) => b.referrals - a.referrals);
        
        let lbMsg = "🌟 ━ ✨ *TOP 10 REFERRERS* ✨ ━ 🌟\n\n";
        const medals = ["🥇", "🥈", "🥉", "🏅", "🏅", "🏅", "🏅", "🏅", "🏅", "🏅"];
        userArray.slice(0, 10).forEach((user, index) => {
            const idStr = String(user.userId);
            let maskedId = idStr.length > 6 ? idStr.substring(0, 3) + "*****" + idStr.substring(idStr.length - 3) : idStr.substring(0, 1) + "***" + idStr.substring(idStr.length - 1);
            lbMsg += `${medals[index]} *Rank ${index + 1}*\n ├ 👤 \`${maskedId}\`\n └ 🎁 *${user.referrals} Referrals*\n\n`;
        });
        lbMsg += "🚀 *Keep inviting friends to see your name here!*";
        return bot.sendMessage(chatId, lbMsg, { parse_mode: 'Markdown' });
    }

    if (data === 'add_admin_btn' && isAdminUser) {
        userStates[userId] = { step: 'ADD_ADMIN_STATE' };
        return bot.sendMessage(chatId, "Send the User ID to promote to Admin:");
    }
    if (data === 'rem_admin_btn' && isAdminUser) {
        userStates[userId] = { step: 'REMOVE_ADMIN_STATE' };
        return bot.sendMessage(chatId, "Send the User ID to remove from Admin:");
    }
    if (data === 'list_admin_btn' && isAdminUser) {
        const snap = await get(ref(db, 'admins'));
        let adminList = `👑 *Master Admin:* \`${ADMIN_ID}\`\n\n`;
        if (snap.exists() && Object.keys(snap.val()).length > 0) {
            adminList += "👨‍💻 *Other Admins:*\n";
            for (const id of Object.keys(snap.val())) adminList += `• \`${id}\`\n`;
        } else adminList += "❌ No other admins found.";
        return bot.sendMessage(chatId, adminList, { parse_mode: 'Markdown' });
    }
    if (data.startsWith('remove_ch_')) {
        if (!isAdminUser) return;
        const channelKey = data.replace('remove_ch_', '');
        await set(ref(db, `channels/${channelKey}`), null);
        bot.sendMessage(chatId, "✅ Channel successfully removed.", ADMIN_MENU);
        bot.editMessageText("✅ Channel removed.", { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
        return;
    }
    if (data === 'verify_join') {
        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) bot.sendMessage(chatId, "❌ You haven't joined all channels yet!");
        else promptDeviceVerification(chatId, userId);
    }
    if (data === 'check_verification') {
        const userRef = ref(db, `users/${userId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) return;
        const userData = userSnap.val();

        const banSnap = await get(ref(db, `banned/${userId}`));
        if (banSnap.exists()) return bot.sendMessage(chatId, "❌ You are banned from using this bot.");

        const usedIpsSnap = await get(ref(db, 'used_ips'));
        let hasFailedRecord = false;
        if (usedIpsSnap.exists()) {
            const ips = usedIpsSnap.val();
            for (let ip in ips) {
                if (String(ips[ip].userId) === String(userId) && ips[ip].status === 'failed') {
                    hasFailedRecord = true;
                    break;
                }
            }
        }

        if (hasFailedRecord || userData.verified === 'failed') {
            if (userData.verified !== 'failed') await update(userRef, { verified: 'failed', rewardGiven: true });
            return bot.sendMessage(chatId, "❌ Verification fail\n\nBut don't worry still you can refer and earn", USER_MENU);
        }

        if (userData.verified === true) {
            bot.sendMessage(chatId, `✅ Verification Successful! Welcome to ${BOT_NAME}.`, USER_MENU);
            if (!userData.rewardGiven && userData.referredBy) {
                const settings = await getSettings();
                await update(userRef, { rewardGiven: true });
                const inviterRef = ref(db, `users/${userData.referredBy}`);
                runTransaction(inviterRef, (inviter) => {
                    if (inviter) {
                        inviter.balance = (inviter.balance || 0) + settings.referAmount;
                        inviter.referrals = (inviter.referrals || 0) + 1;
                    }
                    return inviter;
                });
                bot.sendMessage(userData.referredBy, `🎉 ₹${settings.referAmount} Credited to Your Balance! Invited : ${userId}`);
            }
        } else {
            bot.sendMessage(chatId, "⏳ Your verification is still pending. Please click 'Open App' to complete it first.");
        }
    }
});

// --- HELPER FUNCTION ---
function promptDeviceVerification(chatId, userId) {
    const miniAppUrl = `https://device-verification-dun.vercel.app?id=${userId}`;
    bot.sendMessage(chatId, "📱 *Device Verification Required*\n\nTo ensure fair usage, please verify your device by clicking 'Open App'. After 3 seconds, close it and click 'Check Verification'.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔗 Open App", web_app: { url: miniAppUrl } }],
                [{ text: "✅ Check Verification", callback_data: "check_verification" }]
            ]
        }
    });
}

console.log(`${BOT_NAME} is running...`)
