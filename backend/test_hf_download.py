import os
import requests
import warnings
from urllib3.exceptions import InsecureRequestWarning

# Suppress insecure request warning
warnings.simplefilter('ignore', InsecureRequestWarning)

# Set the mirror environment variable
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

# Global monkey-patch to disable SSL verification for all requests
original_request = requests.Session.request
def patched_request(self, *args, **kwargs):
    kwargs['verify'] = False
    return original_request(self, *args, **kwargs)
requests.Session.request = patched_request

print("Attempting to initialize SentenceTransformer with hf-mirror and global SSL bypass...")
from sentence_transformers import SentenceTransformer

try:
    # Attempt to load/download the model
    model = SentenceTransformer("BAAI/bge-m3", device="cpu")
    print("Success! Model loaded successfully!")
except Exception as e:
    print(f"Error loading model: {e}")
