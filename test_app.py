import unittest
import json
import os
import sqlite3
import sys

# Add directory to path to import app
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from app import app, DATABASE_PATH, calculate_euclidean_distance, generate_creative_bio

class TestPerceptionBackend(unittest.TestCase):
    
    def setUp(self):
        # Configure app for testing
        app.config['TESTING'] = True
        self.client = app.test_client()
        
        # Backup existing database and create a temporary clean one
        self.db_backup = DATABASE_PATH + '.bak'
        if os.path.exists(DATABASE_PATH):
            if os.path.exists(self.db_backup):
                os.remove(self.db_backup)
            os.rename(DATABASE_PATH, self.db_backup)
            
        # Re-initialize fresh test database
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
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

    def tearDown(self):
        # Remove test database and restore backup if any
        if os.path.exists(DATABASE_PATH):
            os.remove(DATABASE_PATH)
        if os.path.exists(self.db_backup):
            os.rename(self.db_backup, DATABASE_PATH)

    def test_euclidean_distance(self):
        v1 = [1.0, 2.0, 3.0]
        v2 = [4.0, 6.0, 3.0]
        # Distance should be sqrt((1-4)^2 + (2-6)^2 + (3-3)^2) = sqrt(9 + 16 + 0) = 5.0
        self.assertEqual(calculate_euclidean_distance(v1, v2), 5.0)
        
        v3 = [0.0]
        v4 = [1.0, 2.0]
        self.assertEqual(calculate_euclidean_distance(v3, v4), float('inf'))

    def test_bio_generation(self):
        bio = generate_creative_bio("Alice", "Seattle", "guitar, coding", "Python, AWS")
        self.assertIn("Alice", bio)
        self.assertIn("Seattle", bio)
        self.assertIn("Python, and AWS", bio)
        self.assertIn("guitar, and coding", bio)

    def test_register_and_match_face(self):
        # 1. Register a face embedding
        embedding = [0.1] * 128
        payload = {
            'name': 'Test User',
            'mobile': '1234567890',
            'address': 'Test City',
            'skills': 'Testing, Python',
            'hobbies': 'Hiking, Chess',
            'embedding': embedding
        }
        
        response = self.client.post('/api/register_face', 
                                    data=json.dumps(payload),
                                    content_type='application/json')
        
        self.assertEqual(response.status_code, 200)
        res_data = json.loads(response.data)
        self.assertTrue(res_data['success'])
        self.assertIn('dynamic specialist', res_data['user']['bio'])
        self.assertIn('Test City', res_data['user']['bio'])
        
        # 2. Try to match the exact same embedding (distance 0.0 < 0.6)
        match_payload = {'embedding': embedding}
        match_response = self.client.post('/api/match_face',
                                          data=json.dumps(match_payload),
                                          content_type='application/json')
        
        self.assertEqual(match_response.status_code, 200)
        match_data = json.loads(match_response.data)
        self.assertTrue(match_data['matched'])
        self.assertEqual(match_data['user']['name'], 'Test User')
        self.assertEqual(match_data['distance'], 0.0)

        # 3. Try to match a slightly modified embedding (distance 0.05 < 0.6)
        modified_embedding = [0.1] * 128
        modified_embedding[0] = 0.15
        match_payload_mod = {'embedding': modified_embedding}
        match_response_mod = self.client.post('/api/match_face',
                                              data=json.dumps(match_payload_mod),
                                              content_type='application/json')
        
        self.assertEqual(match_response_mod.status_code, 200)
        match_data_mod = json.loads(match_response_mod.data)
        self.assertTrue(match_data_mod['matched'])
        self.assertLess(match_data_mod['distance'], 0.6)

        # 4. Try to match a very different embedding (distance > 0.6)
        far_embedding = [0.9] * 128
        match_payload_far = {'embedding': far_embedding}
        match_response_far = self.client.post('/api/match_face',
                                              data=json.dumps(match_payload_far),
                                              content_type='application/json')
        
        self.assertEqual(match_response_far.status_code, 200)
        match_data_far = json.loads(match_response_far.data)
        self.assertFalse(match_data_far['matched'])

if __name__ == '__main__':
    unittest.main()
