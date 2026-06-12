import os
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("SERPAPI_KEY")
print("Using SERPAPI_KEY:", api_key)

url = "https://serpapi.com/search"
params = {
    "engine": "google_images",
    "q": "right angle triangle",
    "api_key": api_key,
    "num": 1,
    "safe": "active"
}

try:
    response = requests.get(url, params=params)
    print("Status Code:", response.status_code)
    data = response.json()
    if "error" in data:
        print("❌ Error from SerpApi:", data["error"])
    elif "images_results" in data and data["images_results"]:
        print("✅ Success! Image found:", data["images_results"][0]["original"])
    else:
        print("❓ No images found. Raw response keys:", list(data.keys()))
except Exception as e:
    print("❌ Exception during test:", e)
