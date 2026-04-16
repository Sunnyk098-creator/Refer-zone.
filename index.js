import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction } from 'firebase/database';
import axios from 'axios';

// --- CONFIGURATION ---
const BOT_TOKEN = '8632582122:AAGB8tUo480bSE0cTeYh5w2NLAiz9P52IT8';
const ADMIN_ID = 8522410574;

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
            ['💰 Balance', '👥 Refer'],
            ['🎁 Bonus', '🔗 Link Wallet'],
            ['🏧 Withdraw']
        ],
        resize_keyboard: true
    }
};

const ADMIN_MENU = {
    reply_markup: {
        keyboard: [
            ['🤖 Bot ON/OFF', '💸 Withdraw ON/OFF'],
            ['📢 Add Channel', '⚙️ Set API Gateway'],
            ['⬇️ Min Withdraw', '⬆️ Max Withdraw'],
            ['👨‍💻 Manage Admins'],
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
async function getSettings() {
    const snap = await get(ref(db, 'settings'));
    const defaultSettings = {
        botStatus: true,
        withdrawStatus: true,
        minWithdraw: 10,
        maxWithdraw: 100,
        apiUrl: "https://your-api.com/pay?user={number}&amount={amount}",
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

    const settings = await getSettings();

    // Check Ban
    const banSnap = await get(ref(db, `banned/${userId}`));
    if (banSnap.exists()) return bot.sendMessage(chatId, "🚫 You are banned from using this bot.");

    // Check Bot Status
    if (!settings.botStatus && userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "🛠 The bot is currently under maintenance.");
    }

    // Admin Command
    if (text === '/skadmin' && userId === ADMIN_ID) {
        userStates[userId] = null;
        return bot.sendMessage(chatId, "👨‍💻 Welcome to the Admin Panel!", ADMIN_MENU);
    }

    // Admin State Handling
    if (userId === ADMIN_ID && userStates[userId]) {
        const state = userStates[userId].step;
        const val = text.trim();
        
        try {
            if (state === 'ADD_CHANNEL') {
                await set(ref(db, `channels/${Date.now()}`), val);
                bot.sendMessage(chatId, `✅ Channel ${val} added successfully.`, ADMIN_MENU);
            } else if (state === 'SET_API') {
                await update(ref(db, 'settings'), { apiUrl: val });
                bot.sendMessage(chatId, "✅ API Gateway updated.", ADMIN_MENU);
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
                bot.sendMessage(chatId, `🚫 User ${val} has been banned.`, ADMIN_MENU);
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
            }
        } catch (err) {
            bot.sendMessage(chatId, "❌ An error occurred updating settings.");
        }
        delete userStates[userId];
        return;
    }

    // Admin Menu Handling
    if (userId === ADMIN_ID) {
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
            return bot.sendMessage(chatId, "Send the channel username (e.g., @mychannel):");
        }
        if (text === '⚙️ Set API Gateway') {
            userStates[userId] = { step: 'SET_API' };
            return bot.sendMessage(chatId, "Send the API URL. Use {number} for wallet and {amount} for amount:");
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
            return bot.sendMessage(chatId, "Send User ID and Amount separated by space (e.g. 12345 50):");
        }
        if (text === '➖ Deduct Amount') {
            userStates[userId] = { step: 'DEDUCT_AMOUNT' };
            return bot.sendMessage(chatId, "Send User ID and Amount separated by space (e.g. 12345 50):");
        }
        if (text === '📊 Stats') {
            const usersSnap = await get(ref(db, 'users'));
            const count = usersSnap.exists() ? Object.keys(usersSnap.val()).length : 0;
            return bot.sendMessage(chatId, `📊 Total Users: ${count}`);
        }
        if (text === '👨‍💻 Manage Admins' || text === '🏆 Leaderboard' || text === '💳 Reset Balance') {
            return bot.sendMessage(chatId, "Feature in development / requires deeper structure configuration.");
        }
    }

    // User Start Command
    if (text.startsWith('/start')) {
        const referredByMatch = text.split(' ')[1];
        let referredBy = null;
        if (referredByMatch && Number(referredByMatch) !== userId) {
            referredBy = Number(referredByMatch);
        }

        const userRef = ref(db, `users/${userId}`);
        const userSnap = await get(userRef);

        if (!userSnap.exists()) {
            await set(userRef, {
                balance: 0,
                referrals: 0,
                referredBy: referredBy || false,
                verified: false,
                rewardGiven: false,
                wallet: false
            });
        }

        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            return bot.sendMessage(chatId, "⚠️ *To use this bot, you MUST join our channels first!*", Object.assign({ parse_mode: 'Markdown' }, generateJoinKeyboard(channelStatus.channels)));
        } else {
            return promptDeviceVerification(chatId, userId);
        }
    }

    // User General States & Commands
    const userRef = ref(db, `users/${userId}`);
    const userSnap = await get(userRef);
    if (!userSnap.exists()) return;
    const userData = userSnap.val();

    if (!userData.verified) {
        return bot.sendMessage(chatId, "❌ You must verify your device first. Type /start to verify.");
    }

    if (text === '💰 Balance') {
        const walletDisplay = userData.wallet ? userData.wallet : "not set";
        const msg = `💰 Balance: ₹${userData.balance}\n\n🗂 Wallet: ${walletDisplay}\n\n🎉 Invite friends, Earn Money & Withdraw To Your Wallet Instantly`;
        return bot.sendMessage(chatId, msg);
    }

    if (text === '👥 Refer') {
        const botInfo = await bot.getMe();
        const refLink = `https://t.me/${botInfo.username}?start=${userId}`;
        const msg = `🎉 Invite Friends & Earn!\n\n💰 Get ₹${settings.referAmount} for each successful invite.\n\n🔗 Your Invite Link: \n${refLink}\n\n📢 Invite friends, grow your community, and earn bonuses with every successful referral. Start now!`;
        return bot.sendMessage(chatId, msg);
    }

    if (text === '🎁 Bonus') {
        const lastBonus = userData.lastBonus || 0;
        const now = Date.now();
        if (now - lastBonus > 86400000) {
            await update(ref(db, `users/${userId}`), { balance: (userData.balance || 0) + settings.bonusAmount, lastBonus: now });
            bot.sendMessage(chatId, `🎁 You received a daily bonus of ₹${settings.bonusAmount}!`);
        } else {
            bot.sendMessage(chatId, "❌ You already claimed your bonus today. Try again tomorrow.");
        }
        return;
    }

    if (text === '🔗 Link Wallet') {
        userStates[userId] = { step: 'LINK_WALLET' };
        return bot.sendMessage(chatId, "📱 Send your wallet number/address to link:");
    }

    if (userStates[userId] && userStates[userId].step === 'LINK_WALLET') {
        await update(ref(db, `users/${userId}`), { wallet: text.trim() });
        delete userStates[userId];
        return bot.sendMessage(chatId, `✅ Wallet linked successfully: ${text.trim()}`, USER_MENU);
    }

    if (text === '🏧 Withdraw') {
        if (!settings.withdrawStatus) return bot.sendMessage(chatId, "❌ Withdrawals are temporarily disabled.");
        if (!userData.wallet) return bot.sendMessage(chatId, "❌ Please link your wallet first using '🔗 Link Wallet'.");
        if (userData.referrals < settings.minRefer) return bot.sendMessage(chatId, `❌ You need at least ${settings.minRefer} referrals to withdraw.`);
        if (userData.balance < settings.minWithdraw) return bot.sendMessage(chatId, `❌ Minimum withdrawal is ₹${settings.minWithdraw}. Your balance: ₹${userData.balance}`);
        
        userStates[userId] = { step: 'WITHDRAW_AMOUNT' };
        return bot.sendMessage(chatId, `💰 Send Total Amount To Withdraw\n\n(Min: ₹${settings.minWithdraw}, Max: ₹${settings.maxWithdraw})`);
    }

    if (userStates[userId] && userStates[userId].step === 'WITHDRAW_AMOUNT') {
        const amt = Number(text);
        delete userStates[userId];

        if (isNaN(amt) || amt < settings.minWithdraw || amt > settings.maxWithdraw || amt > userData.balance) {
            return bot.sendMessage(chatId, "❌ Invalid amount. Try again via '🏧 Withdraw'.", USER_MENU);
        }

        // Deduct balance instantly
        await update(ref(db, `users/${userId}`), { balance: userData.balance - amt });
        bot.sendMessage(chatId, "⏳ Processing withdrawal...", USER_MENU);

        try {
            const finalUrl = settings.apiUrl.replace('{number}', userData.wallet).replace('{amount}', amt);
            const response = await axios.get(finalUrl);
            
            if (response.status === 200) {
                bot.sendMessage(chatId, `💸 Your Withdrawal Paid Successfully !! 💸\n\n🎉 Please Check Your Wallet 🎉`);
            } else {
                throw new Error("API Returned non-200");
            }
        } catch (e) {
            // Refund on failure
            const freshUser = (await get(ref(db, `users/${userId}`))).val();
            await update(ref(db, `users/${userId}`), { balance: freshUser.balance + amt });
            bot.sendMessage(chatId, "❌ Withdrawal failed via API. Balance refunded.");
        }
        return;
    }
});

// --- CALLBACK QUERY HANDLER ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id);

    if (data === 'verify_join') {
        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            bot.sendMessage(chatId, "❌ You haven't joined all channels yet!");
        } else {
            promptDeviceVerification(chatId, userId);
        }
    }

    if (data === 'check_verification') {
        const userRef = ref(db, `users/${userId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) return;
        const userData = userSnap.val();

        if (userData.verified) {
            bot.sendMessage(chatId, "✅ Verification Successful! Welcome to the Bot.", USER_MENU);

            // Process Referral Logic
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
            // VERIFICATION FAILED: BAN USER
            await set(ref(db, `banned/${userId}`), true);
            bot.sendMessage(chatId, "❌ Verification failed. Your account has been permanently banned.");
        }
    }
});

// --- HELPER FUNCTION ---
function promptDeviceVerification(chatId, userId) {
    const miniAppUrl = `https://device-verification-dun.vercel.app?id=${userId}`;
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔗 Open App", web_app: { url: miniAppUrl } }],
                [{ text: "✅ Check Verification", callback_data: "check_verification" }]
            ]
        }
    };
    bot.sendMessage(chatId, "📱 *Device Verification Required*\n\nTo ensure fair usage, please verify your device by clicking 'Open App'. After 3 seconds, close it and click 'Check Verification'.\n\n⚠️ *Warning:* If your verification fails, your account will be permanently banned.", Object.assign({ parse_mode: 'Markdown' }, opts));
}

console.log("Bot is running...");
