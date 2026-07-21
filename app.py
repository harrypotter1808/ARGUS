import os
import json
import math
import sqlite3
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, 'faces.db')
STATIC_DIR = os.path.join(BASE_DIR, 'static')
TEMPLATES_DIR = os.path.join(BASE_DIR, 'templates')

app = Flask(__name__, static_folder=STATIC_DIR, template_folder=TEMPLATES_DIR)
CORS(app)

DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db_connection():
    if DATABASE_URL:
        # Normalize database URL for psycopg2 (Heroku/Render postgres:// fix)
        url = DATABASE_URL
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        import psycopg2
        from psycopg2.extras import RealDictCursor
        conn = psycopg2.connect(url, cursor_factory=RealDictCursor)
        return conn, 'postgres'
    else:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        return conn, 'sqlite'

def init_db():
    conn, db_type = get_db_connection()
    cursor = conn.cursor()
    if db_type == 'postgres':
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                mobile TEXT,
                address TEXT,
                hobbies TEXT,
                skills TEXT,
                bio TEXT,
                embedding TEXT NOT NULL
            )
        ''')
    else:
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                mobile TEXT,
                address TEXT,
                hobbies TEXT,
                skills TEXT,
                bio TEXT,
                embedding TEXT NOT NULL
            )
        ''')
    conn.commit()
    conn.close()

init_db()

def generate_creative_bio(name, address, hobbies, skills):
    """
    Synthesizes a creative, professional paragraph based on user inputs.
    """
    skills_list = [s.strip() for s in skills.split(',') if s.strip()]
    hobbies_list = [h.strip() for h in hobbies.split(',') if h.strip()]
    
    # Format skills and hobbies nicely
    if len(skills_list) > 1:
        skills_str = ", ".join(skills_list[:-1]) + ", and " + skills_list[-1]
    elif skills_list:
        skills_str = skills_list[0]
    else:
        skills_str = "various technical methodologies"
        
    if len(hobbies_list) > 1:
        hobbies_str = ", ".join(hobbies_list[:-1]) + ", and " + hobbies_list[-1]
    elif hobbies_list:
        hobbies_str = hobbies_list[0]
    else:
        hobbies_str = "exploring new interests"

    loc_str = f" based in {address.strip()}" if address.strip() else ""
    
    bio_template = (
        f"Meet {name.strip()}{loc_str}. A dynamic specialist skilled in {skills_str}, "
        f"they bring a wealth of expertise and a passion for building innovative solutions. "
        f"When they aren't working with technology, {name.strip()} is an enthusiast of {hobbies_str}, "
        f"constantly seeking balance between professional excellence and creative hobbies."
    )
    return bio_template

def calculate_euclidean_distance(embedding1, embedding2):
    if len(embedding1) != len(embedding2):
        return float('inf')
    sq_sum = sum((x - y) ** 2 for x, y in zip(embedding1, embedding2))
    return math.sqrt(sq_sum)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/match_face', methods=['POST'])
def match_face():
    data = request.get_json()
    if not data or 'embedding' not in data:
        return jsonify({'error': 'Missing face embedding'}), 400
    
    input_embedding = data['embedding']
    if not isinstance(input_embedding, list) or len(input_embedding) == 0:
        return jsonify({'error': 'Invalid embedding format'}), 400
        
    conn, db_type = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users')
    rows = cursor.fetchall()
    conn.close()
    
    best_match = None
    min_distance = float('inf')
    
    # Highly selective match threshold (reduced from 0.6 to 0.48 to avoid false positives)
    match_threshold = 0.48
    
    for row in rows:
        db_embedding = json.loads(row['embedding'])
        distance = calculate_euclidean_distance(input_embedding, db_embedding)
        if distance < min_distance:
            min_distance = distance
            best_match = row
            
    if best_match and min_distance < match_threshold:
        user_info = {
            'id': best_match['id'],
            'name': best_match['name'],
            'mobile': best_match['mobile'],
            'address': best_match['address'],
            'hobbies': best_match['hobbies'],
            'skills': best_match['skills'],
            'bio': best_match['bio']
        }
        return jsonify({
            'matched': True,
            'distance': min_distance,
            'user': user_info
        })
    else:
        return jsonify({
            'matched': False,
            'distance': min_distance if min_distance != float('inf') else None
        })

@app.route('/api/register_face', methods=['POST'])
def register_face():
    data = request.get_json()
    required = ['name', 'embedding']
    if not data or not all(k in data for k in required):
        return jsonify({'error': 'Missing required fields (name, embedding)'}), 400
        
    name = data['name']
    mobile = data.get('mobile', '')
    address = data.get('address', '')
    hobbies = data.get('hobbies', '')
    skills = data.get('skills', '')
    embedding = data['embedding']
    
    if not isinstance(embedding, list) or len(embedding) == 0:
        return jsonify({'error': 'Invalid embedding format'}), 400
        
    bio = generate_creative_bio(name, address, hobbies, skills)
    
    conn, db_type = get_db_connection()
    cursor = conn.cursor()
    
    try:
        if db_type == 'postgres':
            cursor.execute('''
                INSERT INTO users (name, mobile, address, hobbies, skills, bio, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
            ''', (name, mobile, address, hobbies, skills, bio, json.dumps(embedding)))
            user_id = cursor.fetchone()['id']
        else:
            cursor.execute('''
                INSERT INTO users (name, mobile, address, hobbies, skills, bio, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (name, mobile, address, hobbies, skills, bio, json.dumps(embedding)))
            user_id = cursor.lastrowid
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({'error': f'Failed to write to database: {e}'}), 500
    
    conn.close()
    
    return jsonify({
        'success': True,
        'user': {
            'id': user_id,
            'name': name,
            'mobile': mobile,
            'address': address,
            'hobbies': hobbies,
            'skills': skills,
            'bio': bio
        }
    })

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
