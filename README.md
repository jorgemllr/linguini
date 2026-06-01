# Linguini 🎧📖🧠

Linguini is an advanced Progressive Web App (PWA) e-reader and audiobook player designed for immersive language learning. It parses highlighted PDF books and synced audiobooks from your Obsidian vault, translates vocabulary in context using natural language models, and synchronizes your reading progress in real-time to a cloud database.

---

## 🚀 Key Features

*   **Cloud Database Sync (Supabase PostgreSQL)**: Completely centralized data layer using a zero-dependency, lightweight PostgREST client. Synchronizes your reading page progress, scroll coordinates, and vocabulary lookup caches instantly between your computer and mobile phone.
*   **Dynamic Page Virtualization (Virtual Scroll)**: Caps the active DOM to a 3-page rendering window `[currentPage - 1, currentPage, currentPage + 1]`. Uses dynamic client-height caching inside the viewport scroll listener to replace out-of-bounds pages with stable estimated placeholders, reducing DOM node counts by 99% for buttery-smooth 120fps scrolling.
*   **Obsidian / Syncthing Vault Integration**: Features a background startup scanner that monitors, extracts, and auto-processes new PDF books and Acrobat highlights directly from your active Obsidian Vault synced directories.
*   **Precision Interactive Text Parsing**: Isolates leading/trailing punctuation (quotes, commas, periods) from alphanumeric word tokens using Unicode property regex. Splits words connected by hyphens, en-dashes (`–`), or em-dashes (`—`) into independently interactive spans.
*   **Contextual Phrase Highlights**: Identifies if a clicked word belongs to an active paragraph-confined phrase highlight. Displays a custom banner with a vertically-centered, tactile **"Ver frase"** button to dynamically load the translation of the entire phrase.
*   **Double-Engine AI Copilot**: Translates and explains grammar using expert context prompts with a dual-API fallback framework (OpenAI GPT-4o-mini as primary, Gemini 2.5 Flash as secondary).

---

## 🛠️ Technology Stack

*   **Frontend**: React, Vite, CSS Modules (Apple iOS Dark Theme style), PWA service-worker.
*   **Backend**: Python, Flask (compatible with direct Vercel Serverless deployments).
*   **Database**: Supabase PostgreSQL (PostgREST HTTP REST API).
*   **PDF Processing**: PyMuPDF (fitz) for structured block-based text and Acrobat highlight extraction.
*   **AI Integration**: OpenAI GPT-4o-mini / Google Gemini 2.5 Flash.

---

## 📦 Local Installation

### 1. Clone the Repository
```bash
git clone https://github.com/jorgemllr/lingua-flow.git
cd lingua-flow
```

### 2. Configure Environment Variables
Create a `.env` file inside the `frontend/` directory:
```env
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Run the Frontend (React Vite PWA)
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Run the Backend (Flask API & Vault Scanner)
```bash
# In a new terminal, from the root directory
pip install -r requirements.txt
python api/index.py
```
The server will boot on [http://localhost:5000](http://localhost:5000), initialize the Supabase connection, scan your Obsidian vault directories, and synchronize any new library items.

---

## 📄 License

This project is licensed under the MIT License.