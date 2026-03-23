import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    await removeFile(dirs);

    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let LadybugBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            // IMPORTANT: register creds.update listener first so creds.json gets written before we read it
            LadybugBot.ev.on('creds.update', saveCreds);

            LadybugBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");

                    // Wait 5 seconds for creds.json to be fully written to disk
                    await delay(5000);

                    try {
                        const credsPath = dirs + '/creds.json';

                        if (!fs.existsSync(credsPath)) {
                            console.error("❌ creds.json not found after delay!");
                            return;
                        }

                        const rawCreds = fs.readFileSync(credsPath);

                        if (!rawCreds || rawCreds.length === 0) {
                            console.error("❌ creds.json is empty!");
                            return;
                        }

                        console.log("📁 creds.json size:", rawCreds.length, "bytes");

                        // Generate session ID: base64 encoded creds.json
                        const sessionId = 'LADYBUG-MD-' + Buffer.from(rawCreds).toString('base64');

                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        // 1. Send session ID as text message
                        await LadybugBot.sendMessage(userJid, {
                            text: `🔑 *Your LadybugBot Session ID:*\n\n${sessionId}\n\n📌 Copy the session ID above and paste it into your bot config.`
                        });
                        console.log("🔑 Session ID sent successfully");
                        await delay(1000);

                        // 2. Send creds.json as document
                        await LadybugBot.sendMessage(userJid, {
                            document: rawCreds,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 creds.json sent successfully");
                        await delay(1000);

                        // 3. Send image/video guide
                        await LadybugBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption: `🎬 *LadybugBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/NjOipI2AoMk`
                        });
                        console.log("🎬 Video guide sent successfully");
                        await delay(1000);

                        // 4. Send warning message
                        await LadybugBot.sendMessage(userJid, {
                            text: `⚠️ Do not share this file with anybody ⚠️\n\n┌┤✑  Thanks for using Ladybug Bot\n│└────────────┈ ⳹\n│©2025 Mr Unique Hacker\n└─────────────────┈ ⳹`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        // 5. Clean up session directory
                        console.log("🧹 Cleaning up session...");
                        await delay(2000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up. Process complete!");

                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!LadybugBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await LadybugBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
