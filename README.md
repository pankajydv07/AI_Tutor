
---

# 🌟 **AI TUTOR – Interactive AI Tutor (AI + Manim + Avatar)**

*Real-time animated video explanations with AI reasoning, Manim visuals, multilingual narration, and AI tutor avatars.*

---

## 🚀 **Overview**

**SOLVEIT AI** is an AI-powered smart tutor that converts any student question into a **stepwise animated video**, accompanied by **multilingual narration** and an expressive **AI avatar teacher**.

It combines the power of **Qwen3-Coder 480B**, **Manim**, **DeepSeek-V3**, and **FastAPI** to deliver an engaging, conceptual, and visual-first learning experience in under **30 seconds**.

---

## 🎯 **Key Features**

* **Real-time Animated Explanations**
  Generates Manim-powered math & concept animations dynamically.

* **Step-by-Step Reasoning (LaTeX + Visuals)**
  Qwen3-Coder produces structured JSON with steps, visuals, and LaTeX.

* **Validation Layer for LaTeX**
  DeepSeek-V3 auto-corrects math formatting to avoid rendering errors.

* **AI Avatar Narration**
  Uses a 3D avatar (Ready Player Me / DID) to narrate explanations naturally.

* **Multilingual TTS**
  OpenAI / ElevenLabs / Google TTS for narration in multiple languages.

* **Interactive Frontend**
  React-based interface for question input, video playback, and history.

* **Knowledge Base**
  Stores generated solutions for faster future recommendations.

---

## 🧠 **How It Works**

```
User Question 
     ↓
Qwen3-Coder 480B → Generates JSON (steps + visuals + LaTeX + narration)
     ↓
DeepSeek-V3 → Validates & fixes LaTeX / visuals
     ↓
Manim Engine → Creates chunked animations
     ↓
TTS Engine → Generates multilingual audio
     ↓
AI Avatar → Lip-sync narration
     ↓
Sync Module → Combines animation + narration + avatar
     ↓
Frontend UI → Delivers interactive learning experience
```

---

## 🏗️ **Tech Stack**

### **Frontend**

* React.js
* Tailwind CSS
* Video.js

### **Backend**

* FastAPI (Python)
* MongoDB (solution storage + metadata)
* Manim (math animations)
* FFmpeg (video & audio sync)

### **AI Models**

* **Qwen3-Coder-480B-Instruct** → reasoning + step generation
* **DeepSeek-V3-0324** → LaTeX validation
* **Hermes-4 / Google TTS / ElevenLabs** → narration
* **AI Avatar** → Ready Player Me / DID

### **Cloud**

* Nebius AI Studio (model inference)
* AWS/GCP for hosting

---

## 📦 **Installation**

### 1️⃣ Clone the repository

```bash
git clone https://github.com/ujjwalpan001/Solveit_AI
cd Solveit_AI
```

### 2️⃣ Install backend dependencies

```bash
pip install -r requirements.txt
```

### 3️⃣ Install Manim

Follow: [https://www.manim.community/](https://www.manim.community/)

### 4️⃣ Install frontend dependencies

```bash
cd client
npm install
npm start
```

---

## ⚙️ **Environment Variables**

Create a `.env` file:

```
NEBIUS_API_KEY=your_key_here
TTS_API_KEY=your_key_here
AVATAR_API_URL=your_avatar_provider
MONGO_URI=your_mongo_db_uri
```

---

## ▶️ **Run the Project**

### Start backend

```bash
uvicorn main:app --reload
```

### Start frontend

```bash
npm start
```

---

## 🧪 **Example Input**

**User:**
`Explain (a+b)^2 with visual proof.`

**Output:**

* Animated decomposition of the square
* LaTeX steps (a+b)(a+b) → a² + 2ab + b²
* Avatar narration
* Final video delivered in < 30 seconds

---

## 📘 **Roadmap**

* [ ] Teacher dashboard
* [ ] Student performance analytics
* [ ] Adaptive learning paths
* [ ] Advanced visual templates (physics, chemistry)
* [ ] Mobile app version

---

## 🤝 **Contributing**

Pull requests are welcome!
For major changes, please open an issue first to discuss what you’d like to improve.

---

## 📜 **License**

MIT License © 2025

---

## 🙌 **Acknowledgements**

* Manim Community
* Nebius AI Studio
* 3Blue1Brown for visual inspiration
* Ready Player Me (Avatar SDK)

---

