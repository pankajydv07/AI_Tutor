import { createContext, useContext, useEffect, useState } from "react";

const backendUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const [videoPolling, setVideoPolling] = useState(new Map()); // Track polling for each session
  const [videoSyncState, setVideoSyncState] = useState(new Map()); // Track video sync state
  
  const chat = async (message, videoMode = false) => {
    setLoading(true);
    // Add user message to chat history immediately
    setChatHistory(prev => [...prev, { type: 'user', text: message }]);
    
    // Generate session ID for this conversation
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const data = await fetch(`${backendUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, videoMode, sessionId }),
    });
    const response = await data.json();
    const resp = response.messages;
    
    console.log("📨 Chat response received:", {
      videoMode,
      messageCount: resp.length,
      firstMessage: resp[0],
      hasAudio: resp[0]?.audio ? `${resp[0].audio.length} chars` : 'none',
      hasLipsync: resp[0]?.lipsync ? 'yes' : 'none',
      animationTimeline: resp[0]?.animationTimeline || 'none'
    });
    
    // Process bot response and add to chat history immediately
    if (videoMode && resp.length > 0) {
      // Combine all text messages for immediate display
      const combinedText = resp.map(msg => msg.text || msg.chatResponse).join(' ');
      
      // Add chat entry with combined text immediately (no video yet)
      const chatEntry = { 
        type: 'assistant', 
        text: combinedText,
        sessionId: sessionId,
        videoGenerating: true,
        videoUrl: null,
        videoExplanation: resp.map(msg => msg.videoExplanation || msg.text).join(' ') // Store explanation for avatar sync
      };
      
      setChatHistory(prev => [...prev, chatEntry]);
      
      // Also add enhanced messages to the avatar message queue with session info
      const enhancedMessages = resp.map(msg => ({
        ...msg,
        sessionId: sessionId,
        videoExplanation: msg.videoExplanation || msg.text
      }));
      
      setMessages((messages) => [...messages, ...enhancedMessages]);
      
      // Start polling for video if in video mode
      if (response.videoGenerating) {
        startVideoPolling(sessionId, chatEntry);
      }
    } else {
      // Regular chat mode - add each message separately
      resp.forEach((msg, index) => {
        console.log(`💬 Adding chat message ${index}:`, {
          text: msg.text,
          hasAudio: msg.audio ? `${msg.audio.length} chars` : 'none',
          hasLipsync: msg.lipsync ? 'yes' : 'none',
          animation: msg.animation,
          facialExpression: msg.facialExpression,
          animationTimeline: msg.animationTimeline || 'none'
        });
        
        setChatHistory(prev => [...prev, { 
          type: 'assistant', 
          text: msg.text || msg.chatResponse,
          videoUrl: msg.videoUrl 
        }]);
      });
      
      // Add messages to avatar queue for speaking/animation
      console.log("🎭 Adding messages to avatar queue:", resp.length, "messages");
      setMessages((messages) => [...messages, ...resp]);
    }
    
    setLoading(false);
  };
  
  const startVideoPolling = (sessionId, chatEntry) => {
    console.log(`🎬 Starting video polling for session: ${sessionId}`);
    
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${backendUrl}/video-ready/${sessionId}`);
        const videoData = await response.json();
        
        if (videoData.ready) {
          console.log(`✅ Video ready for session ${sessionId}: ${videoData.videoUrl}`);
          
          // Update the chat history to include the video
          setChatHistory(prev => prev.map(msg => 
            msg.sessionId === sessionId 
              ? { ...msg, videoUrl: videoData.videoUrl, videoGenerating: false }
              : msg
          ));
          
          // Initialize video sync state for this session
          setVideoSyncState(prev => new Map(prev).set(sessionId, {
            videoReady: true,
            isPlaying: false,
            currentTime: 0,
            audioContext: null,
            audioBuffer: null,
            audioSource: null
          }));
          
          // Clear the polling interval
          clearInterval(pollInterval);
          setVideoPolling(prev => {
            const newMap = new Map(prev);
            newMap.delete(sessionId);
            return newMap;
          });
        }
      } catch (error) {
        console.error(`❌ Error polling for video ${sessionId}:`, error);
      }
    }, 2000); // Poll every 2 seconds
    
    // Store the interval for cleanup
    setVideoPolling(prev => new Map(prev).set(sessionId, pollInterval));
    
    // Auto-cleanup after 5 minutes to prevent infinite polling
    setTimeout(() => {
      clearInterval(pollInterval);
      setVideoPolling(prev => {
        const newMap = new Map(prev);
        newMap.delete(sessionId);
        return newMap;
      });
      console.log(`⏰ Video polling timeout for session ${sessionId}`);
    }, 300000); // 5 minutes
  };

  // Avatar speech synchronization functions
  const handleVideoPlay = (sessionId) => {
    console.log(`🎵 Video started playing for session: ${sessionId}`);
    setVideoSyncState(prev => {
      const newMap = new Map(prev);
      const syncState = newMap.get(sessionId);
      if (syncState) {
        newMap.set(sessionId, { ...syncState, isPlaying: true });
      }
      return newMap;
    });
  };

  const handleVideoPause = (sessionId) => {
    console.log(`⏸️ Video paused for session: ${sessionId}`);
    setVideoSyncState(prev => {
      const newMap = new Map(prev);
      const syncState = newMap.get(sessionId);
      if (syncState) {
        newMap.set(sessionId, { ...syncState, isPlaying: false });
      }
      return newMap;
    });
  };

  const handleVideoSeek = (sessionId, time) => {
    console.log(`⏭️ Video seeked to ${time}s for session: ${sessionId}`);
    setVideoSyncState(prev => {
      const newMap = new Map(prev);
      const syncState = newMap.get(sessionId);
      if (syncState) {
        newMap.set(sessionId, { 
          ...syncState, 
          currentTime: time,
          lastUpdateTime: Date.now() // Track when this update occurred
        });
      }
      return newMap;
    });
  };

  const handleVideoEnd = (sessionId) => {
    console.log(`🔚 Video ended for session: ${sessionId}`);
    setVideoSyncState(prev => {
      const newMap = new Map(prev);
      const syncState = newMap.get(sessionId);
      if (syncState) {
        newMap.set(sessionId, { ...syncState, isPlaying: false, currentTime: 0 });
      }
      return newMap;
    });
  };

  const getVideoSyncState = (sessionId) => {
    return videoSyncState.get(sessionId) || null;
  };
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState();
  const [loading, setLoading] = useState(false);
  const [cameraZoomed, setCameraZoomed] = useState(true);
  const [chatHistory, setChatHistory] = useState([]);
  const onMessagePlayed = () => {
    setMessages((messages) => messages.slice(1));
  };

  useEffect(() => {
    if (messages.length > 0) {
      setMessage(messages[0]);
    } else {
      setMessage(null);
    }
  }, [messages]);

  return (
    <ChatContext.Provider
      value={{
        chat,
        message,
        onMessagePlayed,
        loading,
        cameraZoomed,
        setCameraZoomed,
        chatHistory,
        handleVideoPlay,
        handleVideoPause,
        handleVideoSeek,
        handleVideoEnd,
        getVideoSyncState
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};
