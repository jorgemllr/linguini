# LinguaFlow 🎧🧠

Una aplicación web progresiva (PWA) diseñada para el aprendizaje inmersivo de idiomas a través de podcasts. Utiliza inteligencia artificial para transcripción, análisis de vocabulario y asistencia gramatical en tiempo real.

## 🚀 Características

* **Arquitectura Híbrida:** * **Offline Core:** Carga instantánea de vocabulario clave pre-procesado.
    * **Online Copilot:** Consultas bajo demanda a OpenAI (GPT-4o) para análisis gramatical y de contexto de cualquier palabra.
* **Smart Player:** Reproductor de audio sincronizado con transcripción interactiva.
* **Optimización de Datos:** Separación de lógica de transcripción (Whisper local) y consumo (React App).
* **Stack Moderno:** React + Vite (Frontend), Flask (Backend Serverless), OpenAI API.

## 🛠️ Tecnologías

* **Frontend:** React, Vite, CSS Modules (Apple Music Style).
* **Backend:** Python, Flask (Deploy en Vercel).
* **AI Processing:** Faster-Whisper (Local Mac M1), GPT-4o-mini.

## 📦 Instalación Local

1.  **Clonar el repositorio:**
    ```bash
    git clone [https://github.com/TU_USUARIO/lingua-flow.git](https://github.com/TU_USUARIO/lingua-flow.git)
    cd lingua-flow
    ```

2.  **Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

3.  **Backend (Copilot AI):**
    ```bash
    # En una nueva terminal, desde la raíz
    pip install -r requirements.txt
    export OPENAI_API_KEY="tu-api-key"
    python api/index.py
    ```

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.