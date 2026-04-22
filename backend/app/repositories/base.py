from sqlalchemy.orm import Session


class Repository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add_and_commit(self, model):
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model
