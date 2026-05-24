import requests
import time

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    print("--- 1. Testing GET /health ---")
    r = requests.get(f"{BASE_URL}/health")
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()}")
    assert r.status_code == 200

    print("\n--- 2. Testing POST /upload-room-video ---")
    with open("test.mp4", "rb") as f:
        files = {"video": ("test.mp4", f, "video/mp4")}
        data = {"room_name": "Living Room"}
        r = requests.post(f"{BASE_URL}/upload-room-video", files=files, data=data)
    
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()}")
    assert r.status_code == 200
    room_id = r.json()["room_id"]

    print("\n--- 3. Testing POST /start-reconstruction/{room_id} ---")
    r = requests.post(f"{BASE_URL}/start-reconstruction/{room_id}")
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()}")
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    print("\n--- 4. Testing GET /job-status/{job_id} ---")
    # Poll for 10 seconds to see the state progression
    for i in range(5):
        r = requests.get(f"{BASE_URL}/job-status/{job_id}")
        data = r.json()
        print(f"Status: {r.status_code} | current_status: {data['status']} | progress: {data['progress']}%")
        if data['status'] == 'complete':
            break
        time.sleep(2)

    print("\n--- 5. Testing GET /room/{room_id} ---")
    r = requests.get(f"{BASE_URL}/room/{room_id}")
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()}")
    assert r.status_code == 200
    
    print("\nAll tests passed successfully!")

if __name__ == "__main__":
    run_tests()
