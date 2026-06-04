from db.mongodb import MongoDB
from embeddings.resume_embeddings import get_resume_embedding

class JobSearchService:
    def __init__(self):
        self.db = MongoDB()

    def search_jobs(self, resume_text: str, limit=50):
        query_embedding, _ = get_resume_embedding(resume_text)
        return self.db.search_similar_jobs(query_embedding, limit)