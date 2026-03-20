from sqlalchemy.orm import Session
from app.models.client import Client


class ClientService:

    def __init__(self, db: Session):
        self.db = db

    def create_client(self, data):

        client = Client(**data)

        self.db.add(client)
        self.db.commit()
        self.db.refresh(client)

        return client

    def get_client(self, client_id):

        return (
            self.db
            .query(Client)
            .filter(Client.id == client_id)
            .first()
        )
