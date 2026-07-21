import os
import urllib.request
import ssl

# Bypass SSL certificate verification if needed (common in some restricted environments)
ssl_context = ssl._create_unverified_context()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
JS_DIR = os.path.join(STATIC_DIR, 'js')
MODELS_DIR = os.path.join(STATIC_DIR, 'models')

# Create directories
os.makedirs(JS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# Files to download
JS_FILES = {
    'tf.min.js': 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js',
    'face-api.js': 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js',
    'coco-ssd.js': 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@latest/dist/coco-ssd.min.js'
}

MODEL_FILES = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model.bin',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model.bin',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model.bin'
]

MODEL_BASE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/'

def download_file(url, dest_path):
    print(f"Downloading {url} to {dest_path}...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, context=ssl_context) as response, open(dest_path, 'wb') as out_file:
            out_file.write(response.read())
        print("Success.")
    except Exception as e:
        print(f"Failed to download {url}: {e}")

if __name__ == '__main__':
    print("Starting download of required JS libraries...")
    for filename, url in JS_FILES.items():
        dest = os.path.join(JS_DIR, filename)
        if not os.path.exists(dest):
            download_file(url, dest)
        else:
            print(f"{filename} already exists, skipping.")

    print("\nStarting download of face-api models...")
    for model_file in MODEL_FILES:
        url = MODEL_BASE_URL + model_file
        dest = os.path.join(MODELS_DIR, model_file)
        if not os.path.exists(dest):
            download_file(url, dest)
        else:
            print(f"{model_file} already exists, skipping.")
            
    print("\nDownloads completed successfully.")
