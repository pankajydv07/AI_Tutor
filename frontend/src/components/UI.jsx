import { useRef, useState } from "react";
import { useChat } from "../hooks/useChat";
import { motion, AnimatePresence } from "framer-motion";
import { InlineVideoPlayer } from './InlineVideoPlayer';
import { VideoPage } from './VideoPage';

export const UI = ({ hidden, showControls = true, showChat = true, ...props }) => {
  const input = useRef();
  const { chat, loading, cameraZoomed, setCameraZoomed, message, chatHistory } = useChat();
  const [isListening, setIsListening] = useState(false);
  const [isVideoMode, setIsVideoMode] = useState(false); // Default to Chat mode
  const [willCreateVideo, setWillCreateVideo] = useState(false); // Toggle for video creation
  const [expandedVideo, setExpandedVideo] = useState(null);
  const [expandedVideoSessionId, setExpandedVideoSessionId] = useState(null);
  const recognition = useRef(null);

  // Initialize Web Speech API
  if (typeof window !== "undefined") {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && !recognition.current) {
      recognition.current = new SpeechRecognition();
      recognition.current.lang = "en-US";
      recognition.current.interimResults = false;
      recognition.current.continuous = false;

      recognition.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        input.current.value = transcript;
        setIsListening(false);
        // Don't auto-send, let user choose Text Only or Create Video
      };

      recognition.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        input.current.placeholder = "Sweetheart, I couldn’t hear you. Try speaking again?";
      };

      recognition.current.onend = () => {
        setIsListening(false);
        input.current.placeholder = isVideoMode ? "Ask for a video explanation..." : "Type your message...";
      };
    }
  }

  const sendMessage = () => {
    const text = input.current.value;
    if (!loading && !message && text.trim()) {
      chat(text, willCreateVideo);
      input.current.value = "";
    }
  };

  const handleVideoExpand = (videoUrl, sessionId) => {
    setExpandedVideo(videoUrl);
    setExpandedVideoSessionId(sessionId);
    setIsVideoMode(true);
  };

  const handleVideoClose = () => {
    setExpandedVideo(null);
    setExpandedVideoSessionId(null);
    setIsVideoMode(false);
  };

  const toggleMic = () => {
    if (!recognition.current) {
      input.current.placeholder = "Speech recognition not supported in this browser.";
      return;
    }
    if (isListening) {
      recognition.current.stop();
    } else {
      recognition.current.start();
      setIsListening(true);
      input.current.placeholder = "Listening to your heart...";
      input.current.value = "";
    }
  };

  if (hidden) {
    return null;
  }

  return (
    <div className="relative h-full">
      {showControls && (
        <button
          onClick={() => setCameraZoomed(!cameraZoomed)}
          className="bg-gray-900/80 hover:bg-gray-800 text-white p-3 rounded-xl transition-all duration-300"
        >
          {cameraZoomed ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
            </svg>
          )}
        </button>
      )}

      {showChat && (
        <div className="h-full flex flex-col relative">
          <motion.button
            onClick={() => {
              setIsVideoMode(!isVideoMode);
              if (!isVideoMode) {
                setExpandedVideo(null);
              }
            }}
            className="absolute left-[40%] -translate-x-1/2 top-6 z-50 bg-black/95 text-white px-8 py-3 rounded-full backdrop-blur-xl shadow-[0_0_15px_rgba(255,255,255,0.15)] border-2 border-white/10 hover:border-white/30 transition-all duration-500 before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-gradient-to-r before:from-[#ff00ea]/20 before:via-[#2600ff]/20 before:to-[#00ffeb]/20 before:blur-xl before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-500"
            style={{
              boxShadow: "0 0 15px rgba(255,255,255,0.15), inset 0 0 20px rgba(255,255,255,0.05), 0 0 2px rgba(255,255,255,0.2)"
            }}
            initial={{ y: -20, opacity: 0 }}
            animate={{ 
              y: 0, 
              opacity: 1,
              boxShadow: [
                "0 0 20px rgba(255,255,255,0.15), inset 0 0 20px rgba(255,255,255,0.05), 0 0 2px rgba(255,255,255,0.2)",
                "0 0 25px rgba(255,255,255,0.2), inset 0 0 25px rgba(255,255,255,0.08), 0 0 3px rgba(255,255,255,0.3)",
                "0 0 20px rgba(255,255,255,0.15), inset 0 0 20px rgba(255,255,255,0.05), 0 0 2px rgba(255,255,255,0.2)"
              ],
              background: [
                "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.95), rgba(0,0,0,0.98))",
                "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.9), rgba(0,0,0,0.95))",
                "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.95), rgba(0,0,0,0.98))"
              ]
            }}
            transition={{
              boxShadow: {
                duration: 2,
                repeat: Infinity,
                repeatType: "reverse"
              }
            }}
            whileHover={{ 
              scale: 1.05,
              y: 0,
              transition: {
                type: "spring",
                stiffness: 400,
                damping: 10
              }
            }}
            whileTap={{ scale: 0.95 }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={isVideoMode ? "video" : "chat"}
                initial={{ opacity: 0, x: isVideoMode ? -20 : 20, scale: 0.8 }}
                animate={{ 
                  opacity: 1, 
                  x: 0, 
                  scale: 1,
                  transition: {
                    type: "spring",
                    stiffness: 400,
                    damping: 20
                  }
                }}
                exit={{ 
                  opacity: 0, 
                  x: isVideoMode ? 20 : -20, 
                  scale: 0.8,
                  transition: {
                    duration: 0.2
                  }
                }}
                className="flex items-center gap-3 text-sm font-medium tracking-wide"
              >
                {!isVideoMode ? (
                  <>
                    <motion.div
                      initial={{ rotate: -30 }}
                      animate={{ rotate: 0 }}
                      transition={{ type: "spring", stiffness: 200 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </motion.div>
                    <span className="relative">
                      <motion.span
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        Chat
                      </motion.span>
                    </span>
                  </>
                ) : (
                  <>
                    <motion.div
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </motion.div>
                    <span className="relative">
                      <motion.span
                        initial={{ y: -10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        Video
                      </motion.span>
                    </span>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.button>
          <AnimatePresence mode="wait">
            {isVideoMode ? (
              <VideoPage
                videoUrl={expandedVideo}
                sessionId={expandedVideoSessionId}
                onClose={handleVideoClose}
              />
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 bg-gray-900/95 backdrop-blur-lg p-6 mb-4 overflow-y-auto"
              >
                <div className="flex flex-col space-y-4">
                {chatHistory.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                      msg.type === 'user'
                        ? 'bg-pink-600/80 text-white rounded-tr-sm'
                        : 'bg-gray-800/80 text-gray-100 rounded-tl-sm'
                    }`}
                  >
                    <p className="text-sm md:text-base">
                      {typeof msg.text === 'string' ? msg.text : 
                       msg.text && msg.text.text ? msg.text.text : 
                       'Message not available'}
                    </p>
                    
                    {/* Show video generation status */}
                    {msg.type === 'assistant' && msg.videoGenerating && (
                      <div className="mt-3 p-3 bg-gray-700/50 rounded-lg border border-pink-500/30">
                        <div className="flex items-center space-x-2">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse"></div>
                            <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse delay-75"></div>
                            <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse delay-150"></div>
                          </div>
                          <p className="text-xs text-pink-400">🎬 Generating educational video...</p>
                        </div>
                      </div>
                    )}
                    
                                {/* Show video if available */}
                        {msg.type === 'assistant' && msg.videoUrl && !msg.videoGenerating && (
                          <div className="mt-3">
                            <InlineVideoPlayer
                              src={msg.videoUrl}
                              onExpand={() => handleVideoExpand(msg.videoUrl, msg.sessionId)}
                              sessionId={msg.sessionId}
                            />
                            <p className="text-xs text-gray-400 mt-1">📹 Educational Video</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-800/80 text-gray-100 px-4 py-3 rounded-2xl rounded-tl-sm">
                        {isVideoMode ? (
                          <div>
                            <div className="flex space-x-2 mb-2">
                              <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse"></div>
                              <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse delay-75"></div>
                              <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse delay-150"></div>
                            </div>
                            <p className="text-xs text-gray-400">🎬 Generating educational video...</p>
                          </div>
                        ) : (
                          <div className="flex space-x-2">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Area */}
          <div className="flex gap-3 items-center bg-gray-900/80 p-4 rounded-2xl backdrop-blur-lg">
            <div className="flex-grow flex items-center relative">
              <input
                className="w-full bg-gray-800/50 text-white placeholder:text-gray-400 p-4 rounded-xl border border-gray-700/50 focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 focus:outline-none transition-all duration-300"
                placeholder={isVideoMode ? "Ask for a video explanation..." : "Type your message..."}
                ref={input}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isListening) {
                    sendMessage();
                  }
                }}
              />
              <motion.button
                onClick={() => setWillCreateVideo(!willCreateVideo)}
                className={`absolute right-3 px-3 py-1.5 rounded-lg backdrop-blur-sm transition-all duration-300 border ${
                  willCreateVideo 
                    ? "bg-pink-500/20 border-pink-500/50 text-pink-400 hover:bg-pink-500/30" 
                    : "bg-gray-800/50 border-gray-600/30 text-gray-400 hover:bg-gray-700/50"
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="flex items-center gap-2 text-xs font-medium">
                  <motion.div
                    animate={{ scale: willCreateVideo ? 1.1 : 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </motion.div>
                  {willCreateVideo ? (
                    <motion.span
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                    >
                      Create Video
                    </motion.span>
                  ) : (
                    <motion.span
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                    >
                      Text Only
                    </motion.span>
                  )}
                </div>
              </motion.button>
            </div>
            <button
              onClick={toggleMic}
              className={`flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white p-4 rounded-xl transition-all duration-300 ${
                isListening ? "ring-2 ring-pink-500/50 bg-gray-700" : ""
              }`}
              disabled={loading || message}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </button>
            <button
              disabled={loading || message || isListening}
              onClick={sendMessage}
              className={`bg-pink-600 hover:bg-pink-500 text-white px-6 p-4 rounded-xl font-medium transition-all duration-300 ${
                loading || message || isListening ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};