# Google Cloud Text-to-Speech Setup Guide

This application now uses Google Cloud Text-to-Speech instead of ElevenLabs for voice generation.

## Setup Instructions

### Option 1: Service Account JSON File (Recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Text-to-Speech API
4. Go to IAM & Admin > Service Accounts
5. Create a new service account with Text-to-Speech permissions
6. Download the JSON key file
7. Add the path to your `.env` file:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
   ```

### Option 2: JSON Credentials in Environment Variable

1. Follow steps 1-6 above
2. Copy the entire JSON content from the downloaded file
3. Add it to your `.env` file as a single line:
   ```
   GOOGLE_TTS_CREDENTIALS={"type": "service_account", "project_id": "your-project-id", "private_key_id": "...", ...}
   ```

## Voice Configuration

The current configuration uses:
- Language: English (US)
- Voice: Wavenet-F (Female)
- Format: MP3
- Speaking Rate: 1.0 (normal)
- Pitch: 0.0 (normal)

You can modify these settings in `backend/index.js` in the `generateSpeech` function.

## Testing

After setting up credentials:

1. Restart the backend server:
   ```bash
   cd backend
   npm start
   ```

2. Look for this log message:
   ```
   ✅ Google Cloud TTS initialized with service account
   ```
   or
   ```
   ✅ Google Cloud TTS initialized with JSON credentials
   ```

3. Test the API by sending a chat message to verify TTS generation works.

## Troubleshooting

- If you see "Google Cloud TTS credentials not found", check your `.env` file
- If you see "Google Cloud TTS client not initialized", verify your JSON credentials are valid
- Make sure the Text-to-Speech API is enabled in your Google Cloud project
- Ensure your service account has the necessary permissions