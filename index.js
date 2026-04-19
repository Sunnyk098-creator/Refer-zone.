import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction } from 'firebase/database';
import axios from 'axios';

// --- CONFIGURATION ---
const BOT_TOKEN = '8643395116:AAGpTA74QTPUXyRmHCAjpH5vOFZ9luz-27E'; // Token
const ADMIN_ID = 8522410574; // Master Admin

const BOT_NAME = "Black tree🌴🤑"; 
const BOT_USERNAME = "BlackTreeUpiBot";

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
            ['Balance', 'Refer Earn'],
            ['Bonus', 'Withdraw'],
            ['Payout method']
        ],
        resize_keyboard: true
    }
};

const ADMIN_MENU = {
    reply_markup: {
        keyboard: [
            ['🤖 Bot ON/OFF', '💸 Withdraw ON/OFF'],
            ['📢 Add Channel', '❌ Remove Channel'], 
            ['📢 Broadcast', '🆔 Chat IDs'], 
            ['📝 Channel Message'], 
            ['⚙️ Set API Gateway', '👨‍💻 Manage Admins'],
            ['⬇️ Min Withdraw', '⬆️ Max Withdraw'],
            ['💰 Refer Amount', '📉 Min Refer'],
            ['🎁 Set Bonus'],
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
        let chId = ch.includes('|') ? ch.split('|')[0] : ch;
        let isJoinedOrRequested = false;
        let explicitStatus = null;

        try {
            const member = await bot.getChatMember(chId, userId);
            explicitStatus = member.status;
            if (['member', 'administrator', 'creator'].includes(member.status)) {
                isJoinedOrRequested = true;
            }
        } catch (e) {}

        if (!isJoinedOrRequested && explicitStatus !== 'left' && explicitStatus !== 'kicked') {
            const pendingReq = await get(ref(db, `join_requests/${chId}/${userId}`));
            if (pendingReq.exists() && pendingReq.val() === true) {
                isJoinedOrRequested = true;
            }
        }

        if (!isJoinedOrRequested) {
            allJoined = false;
            pending.push(ch); 
        }
    }
    return { allJoined, channels: pending };
}

function generateJoinKeyboard(channels) {
    let buttons = channels.map((ch) => {
        let url = ch.includes('|') ? ch.split('|')[1] : `https://t.me/${ch.replace('@', '')}`;
        return { text: `📢 Join`, url: url };
    });

    let keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
        keyboard.push(buttons.slice(i, i + 2));
    }
    keyboard.push([{ text: '✅ Verify Join', callback_data: 'verify_join' }]);
    
    return { reply_markup: { inline_keyboard: keyboard } };
}

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || ''; 
    const firstName = msg.from.first_name || 'User';

    const isAdminUser = await checkIsAdmin(userId);

    if (text === '/dev') return bot.sendMessage(chatId, "Made by [Alpha](https://t.me/ALPHAxBMW)", { parse_mode: 'Markdown', disable_web_page_preview: true });
    if (text === '/build') return bot.sendMessage(chatId, "Made by [Sunny](https://t.me/sunnybotmaker)", { parse_mode: 'Markdown', disable_web_page_preview: true });

    const settings = await getSettings();

    const banSnap = await get(ref(db, `banned/${userId}`));
    if (banSnap.exists()) return bot.sendMessage(chatId, "🚫 You are banned from using this bot.");

    if (!settings.botStatus && !isAdminUser) {
        return bot.sendMessage(chatId, `🛠 ${BOT_NAME} is currently under maintenance.`);
    }

    if (text === '/skadmin' && isAdminUser) {
        delete userStates[userId];
        return bot.sendMessage(chatId, "👨‍💻 Welcome to the Admin Panel!", ADMIN_MENU);
    }

    const userRef = ref(db, `users/${userId}`);
    const userSnap = await get(userRef);
    let userData = userSnap.exists() ? userSnap.val() : null;

    // --- START COMMAND ---
    if (text.startsWith('/start')) {
        const referredByMatch = text.split(' ')[1];
        let referredBy = false;
        if (referredByMatch && Number(referredByMatch) !== userId) {
            referredBy = Number(referredByMatch);
        }

        if (!userData) {
            userData = {
                balance: 0,
                referrals: 0,
                referredBy: referredBy,
                verified: false,
                rewardGiven: false,
                wallet: "Not Linked"
            };
            await set(userRef, userData);
        } else if (referredBy && !userData.referredBy) {
            await update(userRef, { referredBy: referredBy });
        }

        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            return bot.sendMessage(chatId, `⚠️ *To use ${BOT_NAME}, you MUST join our channels first!*`, Object.assign({ parse_mode: 'Markdown' }, generateJoinKeyboard(channelStatus.channels)));
        } else {
            // Passing firstName here
            return promptDeviceVerification(chatId, userId, firstName);
        }
    }

    if (!userData && !isAdminUser) return;

    if (userData && userData.verified === false && !isAdminUser) {
        return bot.sendMessage(chatId, "❌ You must verify your device first. Type /start to verify.");
    }

    // ==========================================
    // STATE HANDLING 
    // ==========================================
    if (userStates[userId] && userStates[userId].step) {
        const state = userStates[userId].step;
        const val = text.trim();

        if (state === 'LINK_WALLET') {
            if (!/^\d{10}$/.test(val)) {
                return bot.sendMessage(chatId, "❌ Invalid format. Please enter exactly 10 digits for your wallet number:");
            }
            await update(userRef, { wallet: val });
            delete userStates[userId];
            return bot.sendMessage(chatId, `✅ Payout Method Saved!\nWallet number ${val} linked successfully! You can now withdraw easily.`, USER_MENU);
        }

        if (state === 'WITHDRAW_AMOUNT') {
            const amt = Number(val);
            
            if (isNaN(amt) || amt < settings.minWithdraw || amt > settings.maxWithdraw || amt > userData.balance) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ Invalid amount or insufficient balance. Try again via 'Withdraw'.", USER_MENU);
            }

            const gws = await getGateways();
            const gwKeys = Object.keys(gws);
            if (gwKeys.length === 0) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ No payment gateways available right now. Please contact admin.");
            }

            let inlineKeyboard = [];
            for (let key in gws) {
                try {
                    const urlObj = new URL(gws[key]);
                    let domain = urlObj.hostname.replace('www.', '');
                    let nameParts = domain.split('.')[0].split('-');
                    let name = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); 
                    
                    inlineKeyboard.push([{ text: `🏦 ${name}`, callback_data: `pay_${amt}_${key}` }]);
                } catch(e) {}
            }

            bot.sendMessage(chatId, `💰 *Amount:* ₹${amt}\n\n👇 *Choose Gateway for Withdrawal:*`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
            delete userStates[userId];
            return;
        }

        if (isAdminUser) {
            let adminStateMatched = true;
            try {
                if (state === 'ADD_CHANNEL') {
                    let channelId;
                    let channelLink = null;

                    if (msg.forward_from_chat && msg.forward_from_chat.type === 'channel') {
                        if (msg.forward_from_chat.username) {
                            channelId = '@' + msg.forward_from_chat.username;
                        } else {
                            channelId = String(msg.forward_from_chat.id);
                        }
                    } else if (val.includes(' ')) {
                        const parts = val.split(' ');
                        channelId = parts[0]; 
                        channelLink = parts[1]; 

                        if (!channelId.startsWith('-100')) {
                            return bot.sendMessage(chatId, "❌ Private Chat ID hamesha -100 se start hota hai.", { parse_mode: 'Markdown' });
                        }
                    } else {
                        channelId = val;
                        if (channelId.includes('t.me/')) {
                            const parts = channelId.split('t.me/');
                            channelId = '@' + parts[1].split('/')[0].replace('+', '');
                        } else if (!channelId.startsWith('@') && !channelId.startsWith('-100')) {
                            channelId = '@' + channelId;
                        }
                    }

                    try {
                        const chatInfo = await bot.getChat(channelId);
                        const botInfo = await bot.getMe();
                        const memberInfo = await bot.getChatMember(chatInfo.id, botInfo.id);
                        
                        if (!['administrator', 'creator'].includes(memberInfo.status)) {
                            return bot.sendMessage(chatId, `❌ Bot is not an Admin in ${chatInfo.title || channelId}. Pehle bot ko admin banayein.`, ADMIN_MENU);
                        } else {
                            const finalId = String(chatInfo.id);
                            const dbValue = channelLink ? `${finalId}|${channelLink}` : finalId;
                            
                            await set(ref(db, `channels/${Date.now()}`), dbValue);
                            bot.sendMessage(chatId, `✅ Channel '${chatInfo.title}' added successfully!`, ADMIN_MENU);
                        }
                    } catch (e) {
                        bot.sendMessage(chatId, `❌ Channel invalid hai ya bot usme add nahi hai.`, { parse_mode: 'Markdown' });
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
                } else if (state === 'SET_BONUS') {
                    await update(ref(db, 'settings'), { bonusAmount: Number(val) });
                    bot.sendMessage(chatId, `✅ Bonus Amount set to ₹${val}.`, ADMIN_MENU);
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
                } else if (state === 'BROADCAST_MESSAGE') {
                    bot.sendMessage(chatId, "⏳ Starting broadcast...");
                    const usersSnap = await get(ref(db, 'users'));
                    let successCount = 0;
                    let failCount = 0;
                    if (usersSnap.exists()) {
                        const users = usersSnap.val();
                        for (let uid in users) {
                            try {
                                await bot.sendMessage(uid, text);
                                successCount++;
                            } catch (e) {
                                failCount++;
                            }
                        }
                    }
                    bot.sendMessage(chatId, `✅ *Broadcast Completed!*\n\n📨 Sent: ${successCount}\n❌ Failed: ${failCount}`, { parse_mode: 'Markdown', reply_markup: ADMIN_MENU.reply_markup });
                } else if (state === 'SEND_CHANNEL_MSG') {
                    const channelKey = userStates[userId].channelKey;
                    const snap = await get(ref(db, `channels/${channelKey}`));
                    
                    if (snap.exists()) {
                        let chData = snap.val();
                        let chId = chData.includes('|') ? chData.split('|')[0] : chData;
                        try {
                            await bot.sendMessage(chId, text);
                            bot.sendMessage(chatId, `✅ Message successfully posted!`, ADMIN_MENU);
                        } catch (e) {
                            bot.sendMessage(chatId, `❌ Failed to send.`, ADMIN_MENU);
                        }
                    } else {
                        bot.sendMessage(chatId, `❌ Channel not found.`, ADMIN_MENU);
                    }
                } else {
                    adminStateMatched = false;
                }
            } catch (err) {
                bot.sendMessage(chatId, "❌ An error occurred processing your request.");
            }

            if (adminStateMatched) {
                delete userStates[userId];
                return; 
            }
        }
    }

    // ==========================================
    // USER MENU BUTTONS
    // ==========================================
    if (text === 'Balance') {
        return bot.sendMessage(chatId, `💰 Balance: ₹${userData.balance || 0}\n\nUse 'Withdraw' button to withdraw your balance to your wallet`);
    }

    if (text === 'Refer Earn') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=${userId}`;
        const msg = `💰 Per Refer Rs.${settings.referAmount} Upi Cash\n\n👤Your Refferal Link: ${refLink}\n\nShare With Your Friend's & Family And Earn Refer Bonus Easily ✨🤑`;
        return bot.sendMessage(chatId, msg, {
            reply_markup: { 
                inline_keyboard: [
                    [{ text: "🏆 Leaderboard", callback_data: "show_user_leaderboard" }, { text: "👥 My Invites", callback_data: "my_invites" }]
                ] 
            }
        });
    }

    if (text === 'Bonus') {
        const lastBonus = userData.lastBonus || 0;
        const now = Date.now();
        if (now - lastBonus > 86400000) {
            await update(userRef, { balance: (Number(userData.balance) || 0) + settings.bonusAmount, lastBonus: now });
            return bot.sendMessage(chatId, `🎁 You received a daily bonus of ₹${settings.bonusAmount}!`);
        } else {
            return bot.sendMessage(chatId, "❌ You already claimed your bonus today. Try again tomorrow.");
        }
    }

    if (text === 'Payout method') {
        const gws = await getGateways();
        if (Object.keys(gws).length === 0) return bot.sendMessage(chatId, "❌ No payment gateways available right now.");
        
        let msg = `Choose Desired Payment Method From Below 👇\n\n`;
        let inlineKeyboard = [];
        let addedDomains = new Set();
        
        for (let key in gws) {
            try {
                const urlObj = new URL(gws[key]);
                let domain = urlObj.hostname.replace('www.', '');
                let baseUrl = urlObj.origin; 
                let nameParts = domain.split('.')[0].split('-');
                let name = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').toUpperCase(); 

                if (!addedDomains.has(domain)) {
                    msg += `🔗 Link : ${baseUrl}\n\n`;
                    inlineKeyboard.push([{ text: `🏦 ${name}`, callback_data: `setwallet_${key}` }]);
                    addedDomains.add(domain);
                }
            } catch(e) {}
        }

        return bot.sendMessage(chatId, msg, { 
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    }

    if (text === 'Withdraw') {
        if (!settings.withdrawStatus) return bot.sendMessage(chatId, "❌ Withdrawals are temporarily disabled.");
        if ((userData.referrals || 0) < settings.minRefer) return bot.sendMessage(chatId, `❌ You need at least ${settings.minRefer} referrals to withdraw.`);
        if ((userData.balance || 0) < settings.minWithdraw) return bot.sendMessage(chatId, `❌ Minimum withdrawal is ₹${settings.minWithdraw}. Your balance: ₹${userData.balance}`);
        
        if (!userData.wallet || userData.wallet === "Not Linked") {
            return bot.sendMessage(chatId, "❌ You haven't linked a payout method yet.\n\nPlease click on 'Payout method' from the menu first to save your number.", USER_MENU);
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
            const msg = `📢 *How to add a channel:*\n\n1️⃣ *Quick Add (Public Channel):*\nForward any message from the public channel to this bot!\n\n2️⃣ *Manual Public Channel:*\nSend the username (e.g. \`@mychannel\`)\n\n3️⃣ *Private Channel:*\nSend the \`Chat ID\` and \`Invite Link\` separated by a space.\n*Example:* \`-1001234567890 https://t.me/+abcde12345\`\n\n💡 *Tip:* Pata nahi Chat ID kya hai? Bot ko simply us channel me Admin banayein, wo turant ID bhej dega.`;
            return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
        if (text === '❌ Remove Channel') {
            const snap = await get(ref(db, 'channels'));
            if (!snap.exists() || Object.keys(snap.val()).length === 0) return bot.sendMessage(chatId, "❌ No channels have been added yet.");
            const channels = snap.val();
            const inlineKeyboard = [];
            for (const [key, ch] of Object.entries(channels)) {
                let displayName = ch.includes('|') ? `Private (${ch.split('|')[0]})` : ch;
                inlineKeyboard.push([{ text: `📢 ${displayName}`, callback_data: 'ignore' }, { text: '❌ Remove', callback_data: `remove_ch_${key}` }]);
            }
            return bot.sendMessage(chatId, "Select a channel to remove:", { reply_markup: { inline_keyboard: inlineKeyboard } });
        }
        
        if (text === '📢 Broadcast') {
            userStates[userId] = { step: 'BROADCAST_MESSAGE' };
            return bot.sendMessage(chatId, "📢 *Send the message you want to broadcast:*", { parse_mode: 'Markdown' });
        }
        
        if (text === '🆔 Chat IDs') {
            const snap = await get(ref(db, 'channels'));
            if (!snap.exists() || Object.keys(snap.val()).length === 0) {
                return bot.sendMessage(chatId, "❌ No channels added in database.");
            }
            
            const channels = snap.val();
            let msg = "🆔 *Active Channels & Chat IDs:*\n\n";
            bot.sendMessage(chatId, "⏳ Checking which channels the bot is still an admin in...");
            
            for (let key in channels) {
                let chData = channels[key];
                let chId = chData.includes('|') ? chData.split('|')[0] : chData;
                let link = chData.includes('|') ? chData.split('|')[1] : null;

                try {
                    const chatInfo = await bot.getChat(chId);
                    const botInfo = await bot.getMe();
                    const memberInfo = await bot.getChatMember(chId, botInfo.id);
                    
                    if (['administrator', 'creator'].includes(memberInfo.status)) {
                        msg += `✅ *Name:* ${chatInfo.title}\n🔸 *ID:* \`${chatInfo.id}\`\n${link ? `🔗 *Link:* ${link}\n` : ''}\n`;
                    } else {
                        msg += `❌ *ID:* \`${chId}\`\n⚠️ Status: Bot is no longer an admin here.\n\n`;
                    }
                } catch (e) {
                    msg += `❌ *ID:* \`${chId}\`\n⚠️ Status: Bot removed or invalid ID.\n\n`;
                }
            }
            return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
        }

        if (text === '📝 Channel Message') {
            const snap = await get(ref(db, 'channels'));
            if (!snap.exists() || Object.keys(snap.val()).length === 0) {
                return bot.sendMessage(chatId, "❌ No channels added in database.");
            }
            const channels = snap.val();
            let inlineKeyboard = [];
            
            for (let key in channels) {
                let chData = channels[key];
                let chId = chData.includes('|') ? chData.split('|')[0] : chData;
                let btnText = chId; 
                
                try {
                    const chatInfo = await bot.getChat(chId);
                    if(chatInfo.title) btnText = chatInfo.title;
                } catch (e) {}
                
                inlineKeyboard.push([{ text: `📢 ${btnText}`, callback_data: `chmsg_${key}` }]);
            }
            
            return bot.sendMessage(chatId, "📝 *Select a channel to send a message to:*", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
        }

        if (text === '👨‍💻 Manage Admins') {
            return bot.sendMessage(chatId, "👨‍💻 *Manage Admins*\n\nSelect an action below:", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "➕ Add Admin", callback_data: "add_admin_btn" }, { text: "➖ Remove Admin", callback_data: "rem_admin_btn" }], [{ text: "📜 Admin List", callback_data: "list_admin_btn" }]] }
            });
        }
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
        if (text === '🎁 Set Bonus') {
            userStates[userId] = { step: 'SET_BONUS' };
            return bot.sendMessage(chatId, "Send the new Daily Bonus amount in Rs:");
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
                    if (status === true || status === "true") success++;
                    else if (status === 'failed') failed++;
                    else pending++;
                }
            }
            return bot.sendMessage(chatId, `📊 *Detailed User Statistics*\n\n👥 *Total Users:* ${total}\n✅ *Verification Successful:* ${success}\n❌ *Verification Failed:* ${failed}\n⏳ *Verification Pending:* ${pending}`, { parse_mode: 'Markdown' });
        }
        if (text === '🏆 Leaderboard') {
            const loadingMsg = await bot.sendMessage(chatId, "⏳ Fetching live real-time data...");
            const usersSnap = await get(ref(db, 'users')); 
            if (!usersSnap.exists()) {
                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                return bot.sendMessage(chatId, "❌ No users found in database.");
            }
            const users = usersSnap.val();
            let userArray = [];
            for (let uid in users) userArray.push({ userId: uid, referrals: Number(users[uid].referrals) || 0 });
            userArray.sort((a, b) => b.referrals - a.referrals);
            let lbMsg = "🏆 *Top 10 Referrers Leaderboard* 🏆\n\n";
            userArray.slice(0, 10).forEach((user, index) => {
                lbMsg += `${index + 1}. [${user.userId}](tg://user?id=${user.userId}) ➖ ${user.referrals} Referrals\n`;
            });
            bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
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
    const firstName = query.from.first_name || 'User';

    if (data !== 'verify_join' && data !== 'show_user_leaderboard') {
        bot.answerCallbackQuery(query.id).catch(()=>{});
    }

    const isAdminUser = await checkIsAdmin(userId);

    if (data === 'verify_join') {
        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            bot.answerCallbackQuery(query.id, { text: "❌ Please join the remaining channels!", show_alert: true }).catch(()=>{});
            
            try {
                await bot.editMessageReplyMarkup(generateJoinKeyboard(channelStatus.channels).reply_markup, {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
            } catch (e) {}
        } else {
            bot.answerCallbackQuery(query.id, { text: "✅ Channels Verified!" }).catch(()=>{});
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            promptDeviceVerification(chatId, userId, firstName);
        }
        return;
    }

    if (data.startsWith('chmsg_') && isAdminUser) {
        const channelKey = data.replace('chmsg_', '');
        userStates[userId] = { step: 'SEND_CHANNEL_MSG', channelKey: channelKey };
        bot.sendMessage(chatId, "📝 *Send the text message you want to post to this channel:*", { parse_mode: 'Markdown' });
        return;
    }
    
    if (data.startsWith('setwallet_')) {
        const gwKey = data.replace('setwallet_', '');
        const gwSnap = await get(ref(db, `gateways/${gwKey}`));
        if (!gwSnap.exists()) return bot.sendMessage(chatId, "❌ Gateway is no longer available.");
        const gwUrl = gwSnap.val();
        
        let urlObj = new URL(gwUrl);
        let domain = urlObj.hostname.replace('www.', '');
        let name = domain.split('.')[0].toUpperCase();
        let baseUrl = urlObj.origin; 
        
        userStates[userId] = { step: 'LINK_WALLET' };
        
        let msg = `💳 Send Your ${name} WALLET Number\n\n🔗 Link : ${baseUrl}\n\nIf you are a new user, Please Register First\n👇👇\n${baseUrl}/register.php`;
        return bot.sendMessage(chatId, msg, { disable_web_page_preview: true });
    }

    if (data.startsWith('pay_')) {
        const parts = data.split('_');
        const amt = Number(parts[1]);
        const gwKey = parts.slice(2).join('_');

        const userRef = ref(db, `users/${userId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) return;
        const uData = userSnap.val();

        if ((Number(uData.balance) || 0) < amt) {
            bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
            return bot.sendMessage(chatId, "❌ Insufficient balance. Transaction cancelled.");
        }

        bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});

        const gwSnap = await get(ref(db, `gateways/${gwKey}`));
        if (!gwSnap.exists()) return bot.sendMessage(chatId, "❌ This gateway is no longer available.");
        const apiUrl = gwSnap.val();

        await update(userRef, { balance: Number(uData.balance) - amt });
        bot.sendMessage(chatId, "⏳ Processing withdrawal...", USER_MENU);

        const walletNumber = uData.wallet;
        try {
            const finalUrl = apiUrl.replace(/{number}/g, walletNumber).replace(/{wallet}/g, walletNumber).replace(/{amount}/g, amt);
            console.log("Calling API:", finalUrl); 

            const response = await axios.get(finalUrl);
            
            if (response.status === 200) {
                bot.sendMessage(chatId, `💸 Your Withdrawal Paid Successfully !! 💸\n\n🎉 Please Check Your Wallet 🎉`);
                const alertMsg = `🚨 *New Withdrawal Successful*\n\n👤 *User ID:* \`${userId}\`\n💰 *Amount:* ₹${amt}\n💳 *Wallet:* \`${walletNumber}\`\n✅ *Status:* Paid via API`;
                // Sent EXCLUSIVELY to Master Admin
                bot.sendMessage(ADMIN_ID, alertMsg, { parse_mode: 'Markdown' });
            } else {
                throw new Error(`API Returned non-200 Status: ${response.status}`);
            }
        } catch (e) {
            const errorMsg = e.response && e.response.data 
                ? JSON.stringify(e.response.data) 
                : e.message;
            
            console.error(`Withdrawal Failed for ${userId}:`, errorMsg);

            const freshUser = (await get(userRef)).val();
            await update(userRef, { balance: (Number(freshUser.balance) || 0) + amt });
            bot.sendMessage(chatId, "❌ Withdrawal failed via API. Balance refunded.");
            
            const adminFailMsg = `⚠️ *Withdrawal Failed*\n\n👤 *User:* \`${userId}\`\n💰 *Amount:* ₹${amt}\n💳 *Wallet:* \`${walletNumber}\`\n❌ *Error:* \`${errorMsg.substring(0, 100)}\``;
            // Sent EXCLUSIVELY to Master Admin
            bot.sendMessage(ADMIN_ID, adminFailMsg, { parse_mode: 'Markdown' });
        }
        return;
    }

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

    if (data === 'show_user_leaderboard') {
        bot.answerCallbackQuery(query.id, { text: "🔄 Fetching live data..." }).catch(()=>{});
        
        const usersSnap = await get(ref(db, 'users')); 
        if (!usersSnap.exists()) return bot.sendMessage(chatId, "❌ Leaderboard is empty.");
        const users = usersSnap.val();
        let userArray = [];
        for (let uid in users) userArray.push({ userId: uid, referrals: Number(users[uid].referrals) || 0 });
        userArray.sort((a, b) => b.referrals - a.referrals);
        
        let lbMsg = "🌟 ━ ✨ *TOP 10 REFERRERS* ✨ ━ 🌟\n\n";
        const medals = ["🥇", "🥈", "🥉", "🏅", "🏅", "🏅", "🏅", "🏅", "🏅", "🏅"];
        userArray.slice(0, 10).forEach((user, index) => {
            const idStr = String(user.userId);
            let maskedId = idStr.length > 6 ? idStr.substring(0, 3) + "*****" + idStr.substring(idStr.length - 3) : idStr.substring(0, 1) + "***" + idStr.substring(idStr.length - 1);
            lbMsg += `${medals[index]} *Rank ${index + 1}*\n ├ 👤 \`${maskedId}\`\n └ 🎁 *${user.referrals} Referrals*\n\n`;
        });
        lbMsg += "🚀 *Keep inviting friends to see your name here!*";
        
        try {
            await bot.editMessageText(lbMsg, { 
                chat_id: chatId, 
                message_id: query.message.message_id, 
                parse_mode: 'Markdown' 
            });
        } catch(e) {}
        return;
    }
    
    if (data === 'my_invites') {
        const usersSnap = await get(ref(db, 'users'));
        let total = 0, verified = 0;
        
        if (usersSnap.exists()) {
            const users = usersSnap.val();
            for (let uid in users) {
                if (users[uid].referredBy === userId) {
                    total++;
                    if (users[uid].rewardGiven === true) {
                        verified++;
                    }
                }
            }
        }
        
        const unjoined = total - verified;
        const invMsg = `🤫 ${total} Users Started From Your Link\n\n🔍 ${unjoined} Users Haven’t Verified\n\n👑 Verified And Credited From :- ${verified}`;
        return bot.sendMessage(chatId, invMsg);
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
    
    // --- VERIFICATION CHECK (UPDATED REFERRAL LOGIC) ---
    if (data === 'check_verification') {
        const userRef = ref(db, `users/${userId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) return;
        let userData = userSnap.val();

        let needsRecovery = false;
        if (userData.balance === undefined) { userData.balance = 0; needsRecovery = true; }
        if (userData.referrals === undefined) { userData.referrals = 0; needsRecovery = true; }
        if (userData.rewardGiven === undefined) { userData.rewardGiven = false; needsRecovery = true; }
        
        if (needsRecovery) {
            await update(userRef, { 
                balance: userData.balance, 
                referrals: userData.referrals, 
                rewardGiven: userData.rewardGiven 
            });
        }

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
            return bot.sendMessage(chatId, `🏡 Welcome To ${BOT_NAME}!\n\n👀 Same Device Detected By System!\n\nStill You Can Refer & Earn 🥳`, USER_MENU);
        }

        if (userData.verified === true || userData.verified === "true") {
            bot.sendMessage(chatId, `🏡 Welcome To ${BOT_NAME}!\n\n🎉 You Can Earn Money From Reffering This Bot To Friend's`, USER_MENU);
            
            // --- FIX APPLIED HERE: Using Firebase runTransaction for 100% accuracy ---
            if (userData.rewardGiven !== true && userData.referredBy && userData.referredBy !== false) {
                const settings = await getSettings();
                const inviterId = userData.referredBy;

                // 1. Mark this user as reward already given so they can't claim twice
                await update(userRef, { rewardGiven: true });
                
                const refAmt = Number(settings.referAmount) || 0;

                // 2. Add amount to inviter's balance safely
                const inviterBalRef = ref(db, `users/${inviterId}/balance`);
                await runTransaction(inviterBalRef, (current) => (current || 0) + refAmt);
                
                // 3. Add +1 to inviter's referral count safely
                const inviterRefRef = ref(db, `users/${inviterId}/referrals`);
                await runTransaction(inviterRefRef, (current) => (current || 0) + 1);
                    
                bot.sendMessage(inviterId, `🎉 *New Referral Verified!*\n\n[${firstName}](tg://user?id=${userId}) successfully verified their device.\n💰 Reward: +₹${refAmt} Added to your balance!`, { parse_mode: 'Markdown' }).catch(()=>{});
            }
        } else {
            bot.sendMessage(chatId, "⏳ Your verification is still pending. Please click 'Open App' to complete it first.");
        }
    }
});

// --- HELPER FUNCTION (UPDATED URL) ---
function promptDeviceVerification(chatId, userId, firstName) {
    const safeName = encodeURIComponent(firstName || 'User');
    const miniAppUrl = `https://device-verification-dun.vercel.app?id=${userId}&name=${safeName}`;
    
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

// ==========================================
// STOP AUTO-APPROVE (CHECK PENDING JOIN REQUESTS) - SILENT MODE
// ==========================================
bot.on('chat_join_request', async (request) => {
    const chatId = request.chat.id;
    const userId = request.from.id;

    try {
        await set(ref(db, `join_requests/${chatId}/${userId}`), true);
        // Message disabled as requested
    } catch (error) {
        console.error("Error storing join request:", error.message);
    }
});

// ==========================================
// AUTO-DETECT CHANNELS (SMART FEATURE)
// ==========================================
bot.on('my_chat_member', async (msg) => {
    if (msg.chat.type === 'channel') {
        const newStatus = msg.new_chat_member.status;
        
        if (newStatus === 'administrator' || newStatus === 'creator') {
            const alertMsg = `🤖 *Bot Successfully Added as Admin!*\n\n📌 *Channel Name:* ${msg.chat.title}\n🆔 *Chat ID:* \`${msg.chat.id}\`\n\n📋 *Private Channel add karne ke liye, ye Chat ID aur apna invite link copy karke bot ko aise bhejein:*\n\`${msg.chat.id} https://t.me/+your_invite_link\``;
            
            const adminIds = new Set();
            adminIds.add(ADMIN_ID);
            
            try {
                const snap = await get(ref(db, 'admins'));
                if (snap.exists()) {
                    const otherAdmins = snap.val();
                    for (let id in otherAdmins) {
                        if (otherAdmins[id] === true) {
                            adminIds.add(Number(id));
                        }
                    }
                }
                
                for (let adminId of adminIds) {
                    bot.sendMessage(adminId, alertMsg, { parse_mode: 'Markdown' }).catch(e => {
                        console.log(`Failed to send alert to admin ${adminId}:`, e.message);
                    });
                }
            } catch (error) {
                console.error("Error fetching admins for notification:", error);
                bot.sendMessage(ADMIN_ID, alertMsg, { parse_mode: 'Markdown' }).catch(()=>{});
            }
        }
    }
});

console.log(`${BOT_NAME} is running...`);
