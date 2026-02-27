require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MessageCentral Configuration
const MESSAGECENTRAL_CONFIG = {
  customerId: 'C-55617103B2D841D',
  password: 'Raj#@1234', // Your actual password (not base64 yet)
  baseURL: 'https://cpaas.messagecentral.com'
};

let authToken = null;
let tokenExpiry = null;

// Helper function to get auth token
async function getAuthToken(forceNew = false) {
  try {
    // Check if existing token is still valid (1 hour expiry)
    if (!forceNew && authToken && tokenExpiry && Date.now() < tokenExpiry) {
      console.log('Using cached auth token');
      return authToken;
    }

    console.log('Getting new auth token from MessageCentral');
    
    // Encode password to Base64
    const encodedPassword = Buffer.from(MESSAGECENTRAL_CONFIG.password).toString('base64');
    
    const response = await axios.get(`${MESSAGECENTRAL_CONFIG.baseURL}/auth/v1/authentication/token`, {
      params: {
        customerId: 'C-55617103B2D841D',
        key: encodedPassword,
        scope: 'NEW',
        country: '91',
        email: 'estartupsuvidha@gmail.com' || ''
      },
      headers: {
        'accept': '*/*'
      }
    });

    console.log('Auth token response:', response.data);

    if (response.data && response.data.token) {
      authToken = response.data.token;
      // Token expires in 1 hour (3600000 ms)
      tokenExpiry = Date.now() + 3600000;
      return authToken;
    } else {
      throw new Error('Failed to get auth token');
    }
  } catch (error) {
    console.error('Error getting auth token:', error.response?.data || error.message);
    throw error;
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'active', 
    message: 'MessageCentral Verify API is running',
    customerId: 'C-55617103B2D841D'
  });
});

/**
 * Send OTP Endpoint
 * POST /start-verify
 */
app.post('/start-verify', async (req, res) => {
  try {
    const { to, channel = 'SMS' } = req.body;

    if (!to) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone number is required' 
      });
    }

    console.log(`📱 Sending OTP to: ${to} via ${channel}`);

    // Extract mobile number (remove +91 if present)
    let mobileNumber = to.replace(/\D/g, '');
    if (mobileNumber.startsWith('91') && mobileNumber.length === 12) {
      mobileNumber = mobileNumber.slice(2);
    }
    // Ensure it's 10 digits
    if (mobileNumber.length !== 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mobile number. Must be 10 digits.'
      });
    }

    // Get auth token
    const token = await getAuthToken();

    // Send OTP via MessageCentral
    const response = await axios.post(
      `${MESSAGECENTRAL_CONFIG.baseURL}/verification/v3/send`,
      null, // No body, all params in URL
      {
        params: {
          countryCode: '91',
          flowType: channel,
          mobileNumber: mobileNumber,
          otpLength: 6 // Optional: 4-8 digits
        },
        headers: {
          'authToken': token
        }
      }
    );

    console.log('Send OTP response:', response.data);

    if (response.data.responseCode === 200) {
      res.json({
        success: true,
        message: 'OTP sent successfully',
        verificationId: response.data.data.verificationId,
        timeout: response.data.data.timeout || '60'
      });
    } else {
      throw new Error(response.data.message || 'Failed to send OTP');
    }

  } catch (error) {
    console.error('❌ Send OTP Error:', error.response?.data || error.message);
    
    let errorMessage = 'Failed to send OTP';
    let statusCode = 500;

    if (error.response) {
      // Handle MessageCentral specific errors
      switch (error.response.data.responseCode) {
        case 800:
          errorMessage = 'Maximum OTP limit reached for this number. Try again later.';
          statusCode = 429;
          break;
        case 501:
          errorMessage = 'Invalid customer ID';
          statusCode = 401;
          break;
        case 511:
          errorMessage = 'Invalid country code';
          statusCode = 400;
          break;
        default:
          errorMessage = error.response.data.message || 'MessageCentral API error';
      }
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

/**
 * Verify OTP Endpoint
 * POST /check-verify
 */
app.post('/check-verify', async (req, res) => {
  try {
    const { verificationId, code } = req.body;

    if (!verificationId || !code) {
      return res.status(400).json({ 
        success: false, 
        error: 'Verification ID and OTP code are required' 
      });
    }

    console.log(`🔐 Verifying OTP for verificationId: ${verificationId}, code: ${code}`);

    // Get auth token
    const token = await getAuthToken();

    // Verify OTP via MessageCentral
    const response = await axios.get(
      `${MESSAGECENTRAL_CONFIG.baseURL}/verification/v3/validateOtp`,
      {
        params: {
          verificationId: verificationId,
          code: code,
          flowType: 'SMS' // or pass from request
        },
        headers: {
          'authToken': token
        }
      }
    );

    console.log('Verify OTP response:', response.data);

    if (response.data.responseCode === 200) {
      res.json({
        success: true,
        message: 'Verification successful',
        status: response.data.data.verificationStatus
      });
    } else {
      // Handle specific error codes
      let errorMessage = 'Verification failed';
      switch (response.data.responseCode) {
        case 702:
          errorMessage = 'Wrong OTP provided';
          break;
        case 703:
          errorMessage = 'Already verified';
          break;
        case 705:
          errorMessage = 'OTP expired';
          break;
        case 700:
          errorMessage = 'Verification failed';
          break;
        default:
          errorMessage = response.data.message || 'Verification failed';
      }
      
      res.json({
        success: false,
        message: errorMessage,
        code: response.data.responseCode
      });
    }

  } catch (error) {
    console.error('❌ Verify OTP Error:', error.response?.data || error.message);
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to verify OTP',
      details: error.response?.data || error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 MessageCentral Verify server is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📱 Customer ID: C-55617103B2D841D`);
  console.log(`\n📝 Test endpoints:`);
  console.log(`   POST http://localhost:${PORT}/start-verify`);
  console.log(`   POST http://localhost:${PORT}/check-verify`);
});
