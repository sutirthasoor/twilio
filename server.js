require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');

const app = express();

// Debug: Check if environment variables are loaded
console.log('✅ Environment variables loaded:');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✓ Present' : '✗ Missing');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✓ Present' : '✗ Missing');
console.log('TWILIO_VERIFY_SERVICE_SID:', process.env.TWILIO_VERIFY_SERVICE_SID ? '✓ Present' : '✗ Missing');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Twilio client
let client;
try {
    client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );
    console.log('✅ Twilio client initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize Twilio client:', error.message);
    process.exit(1);
}

const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'active', 
        message: 'Twilio Verify API is running',
        serviceSid: verifyServiceSid 
    });
});

/**
 * Send OTP Endpoint
 * POST /start-verify
 * Body: { "to": "+919876543210", "channel": "sms" }
 */
app.post('/start-verify', async (req, res) => {
    try {
        const { to, channel = 'sms', locale = 'en' } = req.body;

        if (!to) {
            return res.status(400).json({ 
                success: false, 
                error: 'Phone number or email is required' 
            });
        }

        console.log(`📱 Sending verification to: ${to} via ${channel}`);

        // Format phone number if it's SMS channel
        let formattedTo = to;
        if (channel === 'sms') {
            // Remove any non-digits
            const digits = to.replace(/\D/g, '');
            // Add +91 for Indian numbers if not present
            if (digits.length === 10) {
                formattedTo = `+91${digits}`;
            } else if (digits.length === 12 && digits.startsWith('91')) {
                formattedTo = `+${digits}`;
            } else if (!to.startsWith('+')) {
                formattedTo = `+${digits}`;
            }
        }

        console.log('Formatted number:', formattedTo);

        const verification = await client.verify.v2
            .services(verifyServiceSid)
            .verifications.create({
                to: formattedTo,
                channel: channel,
                locale: locale
            });

        console.log('✅ Verification created:', verification.sid);

        res.json({
            success: true,
            status: verification.status,
            to: verification.to,
            sid: verification.sid
        });

    } catch (error) {
        console.error('❌ Send OTP Error:', error);
        
        // Handle specific Twilio errors
        let errorMessage = 'Failed to send verification code';
        let statusCode = 500;
        
        if (error.code === 60200) {
            errorMessage = 'Invalid phone number format';
            statusCode = 400;
        } else if (error.code === 60203) {
            errorMessage = 'Maximum send attempts reached. Please try again later.';
            statusCode = 429;
        } else if (error.code === 60205) {
            errorMessage = 'Invalid channel selected';
            statusCode = 400;
        } else if (error.code === 20404) {
            errorMessage = 'Invalid Verify Service SID';
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            code: error.code,
            details: error.message
        });
    }
});

/**
 * Verify OTP Endpoint
 * POST /check-verify
 * Body: { "to": "+919876543210", "code": "123456" }
 */
app.post('/check-verify', async (req, res) => {
    try {
        const { to, code } = req.body;

        if (!to || !code) {
            return res.status(400).json({ 
                success: false, 
                error: 'Phone number and verification code are required' 
            });
        }

        console.log(`🔐 Verifying code for: ${to}`);

        // Format phone number if needed
        let formattedTo = to;
        if (!to.startsWith('+')) {
            const digits = to.replace(/\D/g, '');
            if (digits.length === 10) {
                formattedTo = `+91${digits}`;
            } else if (digits.length === 12 && digits.startsWith('91')) {
                formattedTo = `+${digits}`;
            } else {
                formattedTo = `+${digits}`;
            }
        }

        const verificationCheck = await client.verify.v2
            .services(verifyServiceSid)
            .verificationChecks.create({
                to: formattedTo,
                code: code
            });

        console.log('✅ Verification check status:', verificationCheck.status);

        if (verificationCheck.status === 'approved') {
            res.json({
                success: true,
                message: 'Verification successful',
                status: verificationCheck.status
            });
        } else {
            res.json({
                success: false,
                message: 'Invalid or expired code',
                status: verificationCheck.status
            });
        }

    } catch (error) {
        console.error('❌ Verify Code Error:', error);
        
        // Handle specific Twilio errors
        let errorMessage = 'Failed to verify code';
        let statusCode = 500;
        
        if (error.code === 20404) {
            errorMessage = 'Verification not found or expired';
            statusCode = 404;
        } else if (error.code === 60202) {
            errorMessage = 'Invalid verification code';
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            code: error.code,
            details: error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server is running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`📱 Verify Service SID: ${verifyServiceSid}`);
    console.log(`\n📝 Test endpoints:`);
    console.log(`   POST http://localhost:${PORT}/start-verify`);
    console.log(`   POST http://localhost:${PORT}/check-verify`);
});