import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { button, useControls } from "leva";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useChat } from "../hooks/useChat";

const facialExpressions = {
  default: {},
  smile: {
    browInnerUp: 0.17,
    eyeSquintLeft: 0.4,
    eyeSquintRight: 0.44,
    noseSneerLeft: 0.1700000727403593,
    noseSneerRight: 0.14000002836874015,
    mouthPressLeft: 0.61,
    mouthPressRight: 0.41000000000000003,
  },
  funnyFace: {
    jawLeft: 0.63,
    mouthPucker: 0.53,
    noseSneerLeft: 1,
    noseSneerRight: 0.39,
    mouthLeft: 1,
    eyeLookUpLeft: 1,
    eyeLookUpRight: 1,
    cheekPuff: 0.9999924982764238,
    mouthDimpleLeft: 0.414743888682652,
    mouthRollLower: 0.32,
    mouthSmileLeft: 0.35499733688813034,
    mouthSmileRight: 0.35499733688813034,
  },
  sad: {
    mouthFrownLeft: 1,
    mouthFrownRight: 1,
    mouthShrugLower: 0.78341,
    browInnerUp: 0.452,
    eyeSquintLeft: 0.72,
    eyeSquintRight: 0.75,
    eyeLookDownLeft: 0.5,
    eyeLookDownRight: 0.5,
    jawForward: 1,
  },
  surprised: {
    eyeWideLeft: 0.5,
    eyeWideRight: 0.5,
    jawOpen: 0.351,
    mouthFunnel: 1,
    browInnerUp: 1,
  },
  angry: {
    browDownLeft: 1,
    browDownRight: 1,
    eyeSquintLeft: 1,
    eyeSquintRight: 1,
    jawForward: 1,
    jawLeft: 1,
    mouthShrugLower: 1,
    noseSneerLeft: 1,
    noseSneerRight: 0.42,
    eyeLookDownLeft: 0.16,
    eyeLookDownRight: 0.16,
    cheekSquintLeft: 1,
    cheekSquintRight: 1,
    mouthClose: 0.23,
    mouthFunnel: 0.63,
    mouthDimpleRight: 1,
  },
  crazy: {
    browInnerUp: 0.9,
    jawForward: 1,
    noseSneerLeft: 0.5700000000000001,
    noseSneerRight: 0.51,
    eyeLookDownLeft: 0.39435766259644545,
    eyeLookUpRight: 0.4039761421719682,
    eyeLookInLeft: 0.9618479575523053,
    eyeLookInRight: 0.9618479575523053,
    jawOpen: 0.9618479575523053,
    mouthDimpleLeft: 0.9618479575523053,
    mouthDimpleRight: 0.9618479575523053,
    mouthStretchLeft: 0.27893590769016857,
    mouthStretchRight: 0.2885543872656917,
    mouthSmileLeft: 0.5578718153803371,
    mouthSmileRight: 0.38473918302092225,
    tongueOut: 0.9618479575523053,
  },
};

const corresponding = {
  A: "viseme_PP",
  B: "viseme_kk",
  C: "viseme_I",
  D: "viseme_AA",
  E: "viseme_O",
  F: "viseme_U",
  G: "viseme_FF",
  H: "viseme_TH",
  X: "viseme_PP",
};

let setupMode = false;

export function Avatar(props) {
  const { nodes, materials, scene } = useGLTF(
    "/models/68a8184c78a54f62ce4e9d73.glb"
  );

  const { message, onMessagePlayed, chat, getVideoSyncState } = useChat();

  const [lipsync, setLipsync] = useState();
  const [videoSyncMode, setVideoSyncMode] = useState(false);
  const [currentVideoSessionId, setCurrentVideoSessionId] = useState(null);
  const [audio, setAudio] = useState();

  useEffect(() => {
    console.log("Message:", message);
    console.log("Lipsync data:", message?.lipsync);
    if (!message) {
      setAnimation("Idle");
      setupMode = false; // Reset setupMode
      setVideoSyncMode(false);
      setCurrentVideoSessionId(null);
      return;
    }
    
    // Check if this is a video explanation message (has videoExplanation or is part of video session)
    const isVideoMessage = message.videoExplanation || (message.sessionId && message.manimCode);
    
    console.log("🔍 Message analysis:", {
      hasVideoExplanation: !!message.videoExplanation,
      hasSessionId: !!message.sessionId,
      hasManimCode: !!message.manimCode,
      isVideoMessage: isVideoMessage,
      useVideoAudio: !!message.useVideoAudio
    });
    
    setAnimation(message.animation);
    setFacialExpression(message.facialExpression);
    setLipsync(message.lipsync);
    
    if (isVideoMessage && message.sessionId) {
      // This is a video explanation - avatar should sync directly with video audio
      console.log("🎬 Setting up video sync mode for session:", message.sessionId);
      setVideoSyncMode(true);
      setCurrentVideoSessionId(message.sessionId);
      
      if (message.useVideoAudio && message.audioUrl) {
        // NEW: Use the video's audio URL directly - no separate avatar audio
        console.log("🎵 Avatar will sync with video audio:", message.audioUrl);
        setAudio(null); // No separate audio - will get from video element directly
      } else {
        // Fallback: Create muted audio for lip sync timing (old behavior)
        const audio = new Audio("data:audio/mp3;base64," + message.audio);
        audio.muted = true;
        setAudio(audio);
      }
      
      // Don't call onMessagePlayed immediately for video messages
      // It will be called when video ends
    } else {
      // Regular chat message - play audio normally with lip-sync
      console.log("💬 Setting up chat mode with TTS audio and lip-sync");
      setVideoSyncMode(false);
      setCurrentVideoSessionId(null);
      
      if (message.audio) {
        const audio = new Audio("data:audio/mp3;base64," + message.audio);
        console.log("🎵 Chat audio created, will play audio with duration:", audio.duration || "unknown");
        
        // Set up event listeners before playing
        audio.onloadedmetadata = () => {
          console.log("🎵 Chat audio metadata loaded, duration:", audio.duration);
        };
        
        audio.ontimeupdate = () => {
          console.log("🎵 Chat audio time update:", audio.currentTime, "/", audio.duration);
        };
        
        audio.onplay = () => {
          console.log("▶️ Chat audio started playing");
        };
        
        audio.onpause = () => {
          console.log("⏸️ Chat audio paused");
        };
        
        audio.onended = () => {
          console.log("🔚 Chat audio ended");
          onMessagePlayed();
        };
        
        audio.onerror = (error) => {
          console.error("❌ Chat audio error:", error);
        };
        
        // Attempt to play
        audio.play().catch((error) => {
          console.error("❌ Audio playback failed:", error);
          console.error("Error details:", error.name, error.message);
        });
        
        setAudio(audio);
      } else {
        console.error("❌ No audio data found for chat message");
        console.log("Message object:", message);
      }
    }
  }, [message]);

  // Handle video synchronization - NEW: Direct sync with video audio
  useEffect(() => {
    if (!videoSyncMode || !currentVideoSessionId) return;

    const videoSyncState = getVideoSyncState(currentVideoSessionId);
    if (!videoSyncState) return;

    console.log("🎵 Video sync state:", videoSyncState);

    // NEW: For messages that use video audio, we don't need separate audio management
    // The lip-sync timing comes directly from the video's currentTime
    if (message && message.useVideoAudio) {
      // Direct synchronization - lip-sync timing comes from video playback
      console.log("🎬 Direct video audio sync - no separate audio needed");
      return;
    }

    // LEGACY: For backward compatibility with old system (separate muted audio)
    if (!audio) return;

    // Check if this is a recent update (within last 500ms) indicating a seek operation
    const isRecentUpdate = videoSyncState.lastUpdateTime && (Date.now() - videoSyncState.lastUpdateTime) < 500;

    if (videoSyncState.isPlaying && audio.paused) {
      // Video is playing, start avatar lip sync timing (muted audio for timing only)
      console.log("▶️ Starting avatar lip sync timing to match video");
      audio.currentTime = videoSyncState.currentTime || 0;
      // Play muted audio for lip-sync timing
      audio.play().catch((error) => console.error("Avatar lip sync timing failed:", error));
    } else if (!videoSyncState.isPlaying && !audio.paused) {
      // Video is paused, pause avatar lip sync timing
      console.log("⏸️ Pausing avatar lip sync timing with video");
      audio.pause();
    }

    // Enhanced sync audio timing with video time for accurate lip sync
    const timeDifference = Math.abs(audio.currentTime - (videoSyncState.currentTime || 0));
    if (videoSyncState.currentTime !== undefined && (timeDifference > 0.2 || isRecentUpdate)) {
      console.log(`⏭️ Syncing avatar lip sync timing: ${audio.currentTime.toFixed(2)} -> ${(videoSyncState.currentTime || 0).toFixed(2)} (diff: ${timeDifference.toFixed(2)}s, recent: ${isRecentUpdate})`);
      audio.currentTime = videoSyncState.currentTime || 0;
    }
  }, [videoSyncMode, currentVideoSessionId, audio, message, getVideoSyncState]);

  // Monitor video sync state changes
  useEffect(() => {
    if (!videoSyncMode || !currentVideoSessionId) return;

    const interval = setInterval(() => {
      const videoSyncState = getVideoSyncState(currentVideoSessionId);
      if (videoSyncState && audio) {
        // Check if video ended
        if (!videoSyncState.isPlaying && videoSyncState.currentTime === 0) {
          console.log("🔚 Video ended, stopping avatar lip sync");
          audio.pause();
          audio.currentTime = 0;
          onMessagePlayed(); // Mark message as played
        }
      }
    }, 500); // Check every 500ms

    return () => clearInterval(interval);
  }, [videoSyncMode, currentVideoSessionId, audio, onMessagePlayed, getVideoSyncState]);

  // Animation Timeline Execution for Chat Mode
  useEffect(() => {
    // Only execute animation timeline for chat mode (non-video messages)
    if (!message || videoSyncMode || !message.animationTimeline || !Array.isArray(message.animationTimeline)) {
      return;
    }

    console.log("🎭 Executing animation timeline for chat mode:", message.animationTimeline);
    
    const timeouts = [];
    
    // Execute each animation timeline entry at specified times
    message.animationTimeline.forEach((timelineItem, index) => {
      const timeoutId = setTimeout(() => {
        console.log(`🎭 Timeline ${index}: ${timelineItem.action} at ${timelineItem.time}s - ${timelineItem.animation} / ${timelineItem.expression}`);
        setAnimation(timelineItem.animation);
        setFacialExpression(timelineItem.expression);
      }, timelineItem.time * 1000); // Convert seconds to milliseconds
      
      timeouts.push(timeoutId);
    });

    // Cleanup function to clear all timeouts when component unmounts or message changes
    return () => {
      timeouts.forEach(timeoutId => clearTimeout(timeoutId));
    };
  }, [message, videoSyncMode]); // Re-run when message changes or videoSyncMode changes

  // Video Mode Animation Control - Only animate when video is playing
  useEffect(() => {
    if (!videoSyncMode || !currentVideoSessionId) return;

    const videoSyncState = getVideoSyncState(currentVideoSessionId);
    if (!videoSyncState) return;

    // Control avatar animation based on video playback state
    if (videoSyncState.isPlaying) {
      // Video is playing - avatar can animate normally
      if (message && message.animation) {
        console.log("▶️ Video playing - enabling avatar animation:", message.animation);
        setAnimation(message.animation);
      }
    } else {
      // Video is paused or stopped - set avatar to idle
      console.log("⏸️ Video paused/stopped - setting avatar to idle");
      setAnimation("Idle");
    }
  }, [videoSyncMode, currentVideoSessionId, getVideoSyncState, message]);

  const { animations } = useGLTF("/models/animations.glb");

  const group = useRef();
  const { actions, mixer } = useAnimations(animations, group);
  const [animation, setAnimation] = useState(
    animations.find((a) => a.name === "Idle") ? "Idle" : animations[0].name
  );
  useEffect(() => {
    if (actions[animation]) {
      actions[animation]
        .reset()
        .fadeIn(mixer?.stats.actions.inUse === 0 ? 0 : 0.5)
        .play();
      return () => {
        if (actions[animation]?.fadeOut) {
          actions[animation].fadeOut(0.5);
        }
      };
    }
  }, [animation]);

  const lerpMorphTarget = (target, value, speed = 0.1) => {
    scene.traverse((child) => {
      if (child.isSkinnedMesh && child.morphTargetDictionary) {
        const index = child.morphTargetDictionary[target];
        if (
          index === undefined ||
          child.morphTargetInfluences[index] === undefined
        ) {
          console.warn(`Morph target ${target} not found on ${child.name}`);
          return;
        }
        child.morphTargetInfluences[index] = THREE.MathUtils.lerp(
          child.morphTargetInfluences[index],
          value,
          speed
        );

        if (!setupMode) {
          try {
            set({
              [target]: value,
            });
          } catch (e) {}
        }
      }
    });
  };

  const [blink, setBlink] = useState(false);
  const [winkLeft, setWinkLeft] = useState(false);
  const [winkRight, setWinkRight] = useState(false);
  const [facialExpression, setFacialExpression] = useState("");

  useFrame(() => {
    // Apply facial expressions
    !setupMode &&
      Object.keys(nodes.EyeLeft.morphTargetDictionary).forEach((key) => {
        const mapping = facialExpressions[facialExpression];
        if (key === "eyeBlinkLeft" || key === "eyeBlinkRight") {
          return;
        }
        if (mapping && mapping[key]) {
          lerpMorphTarget(key, mapping[key], 0.1);
        } else {
          lerpMorphTarget(key, 0, 0.1);
        }
      });

    lerpMorphTarget("eyeBlinkLeft", blink || winkLeft ? 1 : 0, 0.5);
    lerpMorphTarget("eyeBlinkRight", blink || winkRight ? 1 : 0, 0.5);

    if (setupMode) {
      return;
    }

    const appliedMorphTargets = [];
    if (message && lipsync) {
      let currentAudioTime = 0;
      let shouldApplyLipSync = false;
      
      // VIDEO MODE: Get timing from video sync state if using video audio
      if (videoSyncMode && currentVideoSessionId && message.useVideoAudio) {
        const videoSyncState = getVideoSyncState(currentVideoSessionId);
        if (videoSyncState && videoSyncState.isPlaying) {
          currentAudioTime = videoSyncState.currentTime || 0;
          shouldApplyLipSync = true;
        } else {
          // Video paused or stopped - no lip sync
          currentAudioTime = -1;
          shouldApplyLipSync = false;
        }
      } 
      // CHAT MODE: Use separate audio timing
      else if (audio && !videoSyncMode) {
        currentAudioTime = audio.currentTime;
        shouldApplyLipSync = !audio.paused && !audio.ended;
      }
      
      // Apply lip-sync based on current time
      if (shouldApplyLipSync && currentAudioTime >= 0 && lipsync.mouthCues) {
        for (let i = 0; i < lipsync.mouthCues.length; i++) {
          const mouthCue = lipsync.mouthCues[i];
          if (
            currentAudioTime >= mouthCue.start &&
            currentAudioTime <= mouthCue.end
          ) {
            const viseme = corresponding[mouthCue.value];
            appliedMorphTargets.push(viseme);
            lerpMorphTarget(viseme, 1, 0.2);
            break;
          }
        }
      }
    }

    // Reset unused visemes
    Object.values(corresponding).forEach((value) => {
      if (appliedMorphTargets.includes(value)) {
        return;
      }
      lerpMorphTarget(value, 0, 0.1);
    });
  });

  useControls("FacialExpressions", {
    chat: button(() => chat()),
    winkLeft: button(() => {
      setWinkLeft(true);
      setTimeout(() => setWinkLeft(false), 300);
    }),
    winkRight: button(() => {
      setWinkRight(true);
      setTimeout(() => setWinkRight(false), 300);
    }),
    animation: {
      value: animation,
      options: animations.map((a) => a.name),
      onChange: (value) => setAnimation(value),
    },
    facialExpression: {
      options: Object.keys(facialExpressions),
      onChange: (value) => setFacialExpression(value),
    },
    enableSetupMode: button(() => {
      setupMode = true;
    }),
    disableSetupMode: button(() => {
      setupMode = false;
    }),
    logMorphTargetValues: button(() => {
      const emotionValues = {};
      Object.keys(nodes.EyeLeft.morphTargetDictionary).forEach((key) => {
        if (key === "eyeBlinkLeft" || key === "eyeBlinkRight") {
          return;
        }
        const value =
          nodes.EyeLeft.morphTargetInfluences[
            nodes.EyeLeft.morphTargetDictionary[key]
          ];
        if (value > 0.01) {
          emotionValues[key] = value;
        }
      });
      console.log(JSON.stringify(emotionValues, null, 2));
    }),
    logVisemeMorphTargets: button(() => {
      console.log("Head morph targets:", nodes.Wolf3D_Head.morphTargetDictionary);
      console.log("Teeth morph targets:", nodes.Wolf3D_Teeth.morphTargetDictionary);
    }),
  });

  const [, set] = useControls("MorphTarget", () =>
    Object.assign(
      {},
      ...Object.keys(nodes.EyeLeft.morphTargetDictionary).map((key) => {
        return {
          [key]: {
            label: key,
            value: 0,
            min: nodes.EyeLeft.morphTargetInfluences[
              nodes.EyeLeft.morphTargetDictionary[key]
            ],
            max: 1,
            onChange: (val) => {
              if (setupMode) {
                lerpMorphTarget(key, val, 1);
              }
            },
          },
        };
      })
    )
  );

  useEffect(() => {
    let blinkTimeout;
    const nextBlink = () => {
      blinkTimeout = setTimeout(() => {
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          nextBlink();
        }, 200);
      }, THREE.MathUtils.randInt(1000, 5000));
    };
    nextBlink();
    return () => clearTimeout(blinkTimeout);
  }, []);

  return (
    <group {...props} dispose={null} ref={group}>
      <primitive object={nodes.Hips} />
      <skinnedMesh
        name="EyeLeft"
        geometry={nodes.EyeLeft.geometry}
        material={materials.Wolf3D_Eye}
        skeleton={nodes.EyeLeft.skeleton}
        morphTargetDictionary={nodes.EyeLeft.morphTargetDictionary}
        morphTargetInfluences={nodes.EyeLeft.morphTargetInfluences}
      />
      <skinnedMesh
        name="EyeRight"
        geometry={nodes.EyeRight.geometry}
        material={materials.Wolf3D_Eye}
        skeleton={nodes.EyeRight.skeleton}
        morphTargetDictionary={nodes.EyeRight.morphTargetDictionary}
        morphTargetInfluences={nodes.EyeRight.morphTargetInfluences}
      />
      <skinnedMesh
        name="Wolf3D_Head"
        geometry={nodes.Wolf3D_Head.geometry}
        material={materials.Wolf3D_Skin}
        skeleton={nodes.Wolf3D_Head.skeleton}
        morphTargetDictionary={nodes.Wolf3D_Head.morphTargetDictionary}
        morphTargetInfluences={nodes.Wolf3D_Head.morphTargetInfluences}
      />
      <skinnedMesh
        name="Wolf3D_Teeth"
        geometry={nodes.Wolf3D_Teeth.geometry}
        material={materials.Wolf3D_Teeth}
        skeleton={nodes.Wolf3D_Teeth.skeleton}
        morphTargetDictionary={nodes.Wolf3D_Teeth.morphTargetDictionary}
        morphTargetInfluences={nodes.Wolf3D_Teeth.morphTargetInfluences}
      />
      <skinnedMesh
        name="Wolf3D_Hair"
        geometry={nodes.Wolf3D_Hair.geometry}
        material={materials.Wolf3D_Hair}
        skeleton={nodes.Wolf3D_Hair.skeleton}
      />
      <skinnedMesh
        name="Wolf3D_Glasses"
        geometry={nodes.Wolf3D_Glasses.geometry}
        material={materials.Wolf3D_Glasses}
        skeleton={nodes.Wolf3D_Glasses.skeleton}
      />
      <skinnedMesh
        name="Wolf3D_Body"
        geometry={nodes.Wolf3D_Body.geometry}
        material={materials.Wolf3D_Body}
        skeleton={nodes.Wolf3D_Body.skeleton}
      />
      <skinnedMesh
        name="Wolf3D_Outfit_Bottom"
        geometry={nodes.Wolf3D_Outfit_Bottom.geometry}
        material={materials.Wolf3D_Outfit_Bottom}
        skeleton={nodes.Wolf3D_Outfit_Bottom.skeleton}
      />
      <skinnedMesh
        name="Wolf3D_Outfit_Footwear"
        geometry={nodes.Wolf3D_Outfit_Footwear.geometry}
        material={materials.Wolf3D_Outfit_Footwear}
        skeleton={nodes.Wolf3D_Outfit_Footwear.skeleton}
      />
      <skinnedMesh
        name="Wolf3D_Outfit_Top"
        geometry={nodes.Wolf3D_Outfit_Top.geometry}
        material={materials.Wolf3D_Outfit_Top}
        skeleton={nodes.Wolf3D_Outfit_Top.skeleton}
      />
    </group>
  );

  // Cleanup Three.js resources
  useEffect(() => {
    return () => {
      if (scene) {
        scene.traverse((obj) => {
          if (obj.geometry) {
            obj.geometry.dispose();
          }
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(mat => mat.dispose());
            } else {
              obj.material.dispose();
            }
          }
          if (obj.skeleton) {
            obj.skeleton.dispose();
          }
        });
      }
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(scene);
      }
    };
  }, []);
}

useGLTF.preload("/models/68a8184c78a54f62ce4e9d73.glb");
useGLTF.preload("/models/animations.glb");