# Lipsync Implementation - Play/Pause Synchronization

## Overview
The avatar lipsync system is fully synchronized with video playback. The lipsync animation automatically starts when you play the video and stops when you pause it.

## How It Works

### 1. **Video Player Integration**
Both `FullVideoPlayer.jsx` and `InlineVideoPlayer.jsx` track video state and sync it with the avatar:

```jsx
// When video plays
video.addEventListener('play', () => {
  handleVideoPlay(sessionId);  // Notifies avatar
});

// When video pauses
video.addEventListener('pause', () => {
  handleVideoPause(sessionId);  // Notifies avatar
});

// When seeking
video.addEventListener('seeking', () => {
  handleVideoSeek(sessionId, video.currentTime);  // Syncs timeline
});
```

### 2. **Avatar Lipsync Logic** (`Avatar.jsx`)

The lipsync is controlled in the `useFrame` hook that runs every render frame:

```jsx
// VIDEO MODE: Get timing from video sync state
if (videoSyncMode && currentVideoSessionId && message.useVideoAudio) {
  const videoSyncState = getVideoSyncState(currentVideoSessionId);
  if (videoSyncState && videoSyncState.isPlaying) {
    currentAudioTime = videoSyncState.currentTime || 0;
    shouldApplyLipSync = true;  // ✅ Lipsync ON
  } else {
    shouldApplyLipSync = false;  // ❌ Lipsync OFF (video paused)
  }
}
```

### 3. **State Management** (`useChat.jsx`)

The video sync state is managed globally and tracks:
- `isPlaying`: Whether video is playing or paused
- `currentTime`: Current playback position
- `lastUpdateTime`: Timestamp for sync accuracy

```jsx
const handleVideoPlay = (sessionId) => {
  setVideoSyncState(prev => {
    const newMap = new Map(prev);
    newMap.set(sessionId, {
      ...newMap.get(sessionId),
      isPlaying: true,
      lastUpdateTime: Date.now()
    });
    return newMap;
  });
};

const handleVideoPause = (sessionId) => {
  setVideoSyncState(prev => {
    const newMap = new Map(prev);
    newMap.set(sessionId, {
      ...newMap.get(sessionId),
      isPlaying: false,
      lastUpdateTime: Date.now()
    });
    return newMap;
  });
};
```

## Behavior

### ✅ **When Video Plays:**
1. Video player fires `play` event
2. `handleVideoPlay()` updates state: `isPlaying = true`
3. Avatar's `useFrame` detects `isPlaying = true`
4. Lipsync animation starts, matching mouth movements to audio

### ⏸️ **When Video Pauses:**
1. Video player fires `pause` event
2. `handleVideoPause()` updates state: `isPlaying = false`
3. Avatar's `useFrame` detects `isPlaying = false`
4. Lipsync animation stops immediately
5. Avatar returns to idle mouth position

### ⏭️ **When Seeking:**
1. Video player fires `seeking` event with new time
2. `handleVideoSeek()` updates `currentTime` in state
3. Avatar's lipsync jumps to corresponding mouth position
4. Ensures avatar stays in sync after timeline scrubbing

## Audio Strategy for Multipart Videos

### Problem Solved:
For multipart videos, we use a dual-audio approach:

1. **Individual Audio Files** (for each video part):
   - Prevents audio repetition when combining videos
   - Each part has its own narration embedded

2. **Combined Audio File** (for avatar lipsync):
   - Avatar syncs with the complete narration timeline
   - Matches the final combined video perfectly

### Backend Implementation:
```javascript
// Generate combined narration for avatar sync
const combinedVideoExplanation = messages.map(msg => msg.videoExplanation).join(' ');
combinedVideoNarrationAudio = await generateVideoNarrationAudio(combinedVideoExplanation, sessionId);

// Generate individual narration for each video part
for (let i = 0; i < messages.length; i++) {
  const partNarrationAudio = await generateVideoNarrationAudio(
    message.videoExplanation, 
    `${sessionId}_part${i}`
  );
  message.narrationAudioFile = partNarrationAudio.audioFile; // For video
  message.lipsync = combinedVideoNarrationAudio.lipsync;      // For avatar
}
```

## Performance Optimizations

1. **Removed Excessive Logging**: Eliminated frame-by-frame console logs
2. **Efficient State Checks**: Direct video sync state queries
3. **Conditional Rendering**: Lipsync only applies when needed

## Testing the Feature

### Single Part Video:
1. Generate a video (e.g., "explain quadratic formula")
2. Click play → Avatar mouth should move with narration
3. Click pause → Avatar mouth should stop moving
4. Seek timeline → Avatar should sync to new position

### Multipart Video:
1. Generate multipart video (e.g., "explain eigenvalues in 2 parts")
2. Play video → Avatar syncs continuously through all parts
3. Pause at any point → Avatar stops immediately
4. No audio repetition in combined video
5. Avatar lipsync matches complete timeline

## Debugging

Enable console logs temporarily to debug:

```jsx
// In Avatar.jsx useFrame hook
console.log("Video playing:", videoSyncState?.isPlaying);
console.log("Current time:", currentAudioTime);
console.log("Should apply lipsync:", shouldApplyLipSync);
```

## Files Modified

1. **backend/index.js**
   - Dual audio generation for multipart videos
   - Individual audio per part + combined audio for avatar

2. **frontend/src/components/Avatar.jsx**
   - Optimized lipsync logic
   - Removed excessive logging
   - Proper play/pause sync

3. **frontend/src/hooks/useChat.jsx**
   - Video sync state management (already implemented)

4. **frontend/src/components/FullVideoPlayer.jsx**
   - Video event handlers (already implemented)

5. **frontend/src/components/InlineVideoPlayer.jsx**
   - Video event handlers (already implemented)

## Conclusion

The lipsync system is fully operational and synchronized with video playback. It automatically:
- ✅ Starts when video plays
- ✅ Stops when video pauses
- ✅ Syncs when seeking
- ✅ Works for single and multipart videos
- ✅ Maintains audio quality without repetition
