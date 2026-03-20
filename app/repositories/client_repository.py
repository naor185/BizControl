from sqlalchemy.orm import Session
from app.models.client import Client


class ClientRepository:

    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, client_id):

        return (
            self.db.query(Client)
            .filter(Client.id == client_id)
            .first()
        )

    def create(self, client):

        self.db.add(client)
        self.db.commit()
        self.db.refresh(client)

        return client
