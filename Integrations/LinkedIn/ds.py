from apify_client import ApifyClient
import os
from dotenv import load_dotenv

load_dotenv()

class LinkedInScraper:
    def __init__(self):
        self.client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
        self.actor_id = os.getenv("APIFY_ACTOR")

    def stream_jobs(self):
        run_input = {
            "urls": [
                "https://www.linkedin.com/jobs/search/?keywords=&location=Netherlands&f_TPR=r604800"
            ],
            "scrapeCompany": True,
            "count": 1000,
        }

        run = self.client.actor(self.actor_id).call(run_input=run_input)
        dataset_id = run["defaultDatasetId"]
        for item in self.client.dataset(dataset_id).iterate_items():
            yield item