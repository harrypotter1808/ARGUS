# ARGUS - Real-Time Face & Object Perception Hub

**ARGUS** (named after the legendary hundred-eyed giant of Greek mythology who kept watch over everything) is a premium, real-time computer vision web application. It performs instant face recognition, 68-point biometric landmark overlay, dynamic AI biography generation, and handheld object detection directly through a webcam stream.

Designed with a high-end, responsive glassmorphic slate dark theme, ARGUS decouples heavy neural network workloads from the browser UI thread to deliver a smooth 60 FPS visual tracking experience.

---

## 🚀 Key Features

* **Biometric Face Recognition**: Detects faces in real-time, extracts 128-dimensional mathematical face descriptors, and performs vector distance searches to recognize registered individuals.
* **Futuristic Wireframe Landmark Mapping**: Overlays a glowing 68-point facial mesh mapping jawline, eyebrows, eyes, nose, and lips dynamically.
* **Handheld Object Perception**: Utilizes TensorFlow.js COCO-SSD to detect and track common objects (like phones, cups, bottles, books, etc.) placed in front of the camera, listing them in a tracking log.
* **AI Biography Synthesis**: On face registration, the backend dynamically compiles a creative, professional profile biography based on the user's name, hobbies, and technical skills.
* **Zero Lag UI (Decoupled Loops)**: Visual scan lines, corner target brackets, and tracking overlays run on a high-speed synchronous canvas loop, while heavy AI inference runs in background threads.
* **Hybrid Storage Architecture**: Automatically falls back to local **SQLite** database for offline development and upgrades to **PostgreSQL** when a database URL is present in the cloud.

---

## 🛠️ Technology Stack

* **Client-Side Vision**: TensorFlow.js, `@vladmandic/face-api` (face detection, landmarks, and embeddings), `@tensorflow-models/coco-ssd` (object detection).
* **Frontend Design**: Vanilla HTML5, CSS3 (Glassmorphism, custom scrollbars, neon styling, keyframe animations), ES6 JavaScript.
* **Backend Server**: Python 3, Flask, Flask-CORS, SQLite3, `psycopg2` (PostgreSQL adapter).
* **Production Serving**: Gunicorn (WSGI HTTP server).

---

## 💻 Local Setup & Running

To run the application locally on your computer:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/ARGUS.git
   cd ARGUS
   ```

2. **Set up a Virtual Environment**:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate      # On Windows
   source .venv/bin/activate   # On Linux/macOS
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Download AI Model Assets**:
   Run the downloader script to cache face-api models and JS libraries locally:
   ```bash
   python download_assets.py
   ```

5. **Start the Development Server**:
   ```bash
   python app.py
   ```
   *Navigate to `http://127.0.0.1:5000` in your web browser.*

---

## ☁️ Deploying to Render & Neon.tech

### Step 1: Create a PostgreSQL DB on Neon
1. Go to [Neon.tech](https://neon.tech) and create a free project.
2. Under **Connection Details**, copy your connection string (e.g., `postgresql://username:password@ep-host.us-east-1.aws.neon.tech/neondb?sslmode=require`).

### Step 2: Set up Render
1. Go to [Render](https://render.com) and create a new **Web Service** connected to your GitHub repository.
2. Set the configuration options:
   * **Runtime**: `Python`
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `gunicorn app:app`
3. Click **Advanced**, select **Add Environment Variable**:
   * **Key**: `DATABASE_URL`
   * **Value**: *[Paste your Neon connection string here]*
4. Click **Create Web Service**.

Once the deploy is live, access your secure HTTPS site, grant webcam access, and run your perception hub online!
