# atm/routers/question_router.py
from atm.core.auth.auth import require_roles
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from enum import Enum
from pydantic import BaseModel
import uuid

from atm.db.database import get_db
from atm.db_models.models import Question, Category
from atm.utils import standard_response


class EntityType(str, Enum):
    APP = "APP"
    ORG = "ORG"


class QuestionCreate(BaseModel):
    question: str
    options: Optional[str] = None
    entity_type: EntityType
    category_id: str


class BulkQuestionCreate(BaseModel):
    questions: List[QuestionCreate]


class CategoryCreate(BaseModel):
    name: str
    entity_type: EntityType
    order: Optional[float] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    order: Optional[float] = None


question_router = APIRouter(tags=["Question"], dependencies=[Depends(require_roles(["USER", "ADMIN"]))])


@question_router.get("/questions")
def get_questions_by_entity_type(
        entity_type: EntityType = Query(..., description="Type of entity to filter by: 'ORG' or 'APP'"),
        db: Session = Depends(get_db)
):
    """
    Get all questions based on the entity_type.
    """
    results = db.query(Question).filter(Question.entity_type == entity_type).all()

    if not results:
        return standard_response(
            200,
            f"No records found for entity_type '{entity_type}'",
            []
        )

    data = [
        {
            "id": r.id,
            "question": r.question,
            "options": r.options,
            "entity_type": r.entity_type,
            "category_id": r.category_id
        } for r in results
    ]

    return standard_response(
        200,
        f"Questions fetched for entity_type '{entity_type}'",
        data
    )


@question_router.get("/questions/grouped")
def get_questions_grouped_by_category(
        entity_type: EntityType = Query(..., description="Type of entity to filter by: 'ORG' or 'APP'"),
        db: Session = Depends(get_db)
):
    """
    Get all questions grouped by category, with category names.
    """
    rows = (
        db.query(Question, Category)
        .join(Category, Question.category_id == Category.id)
        .filter(Question.entity_type == entity_type)
        .order_by(Category.order, Category.name)
        .all()
    )

    if not rows:
        return standard_response(200, f"No questions found for entity_type '{entity_type}'", [])

    grouped = {}
    for question, category in rows:
        cid = category.id
        if cid not in grouped:
            grouped[cid] = {
                "category_id": cid,
                "category_name": category.name,
                "order": float(category.order) if category.order is not None else None,
                "questions": []
            }
        grouped[cid]["questions"].append({
            "id": question.id,
            "question": question.question,
            "options": question.options,
            "entity_type": question.entity_type,
        })

    return standard_response(
        200,
        f"Questions grouped by category for entity_type '{entity_type}'",
        list(grouped.values())
    )


@question_router.post("/questions", dependencies=[Depends(require_roles("ADMIN"))])
def create_question(
        body: QuestionCreate,
        db: Session = Depends(get_db)
):
    """
    Create a single question under an existing category.
    """
    category = db.query(Category).filter(Category.id == body.category_id).first()
    if not category:
        return standard_response(404, f"Category '{body.category_id}' not found", None)

    new_q = Question(
        id=str(uuid.uuid4()),
        question=body.question,
        options=body.options,
        entity_type=body.entity_type,
        category_id=body.category_id,
    )
    db.add(new_q)
    db.commit()
    db.refresh(new_q)

    return standard_response(201, "Question created successfully", {
        "id": new_q.id,
        "question": new_q.question,
        "options": new_q.options,
        "entity_type": new_q.entity_type,
        "category_id": new_q.category_id,
    })


@question_router.post("/questions/bulk", dependencies=[Depends(require_roles("ADMIN"))])
def create_questions_bulk(
        body: BulkQuestionCreate,
        db: Session = Depends(get_db)
):
    """
    Create multiple questions at once. All must reference valid categories.
    """
    if not body.questions:
        return standard_response(400, "No questions provided", None)

    # Validate all category_ids up front
    category_ids = {q.category_id for q in body.questions}
    existing_cats = {c.id for c in db.query(Category.id).filter(Category.id.in_(category_ids)).all()}
    missing = category_ids - existing_cats
    if missing:
        return standard_response(404, f"Categories not found: {', '.join(missing)}", None)

    created = []
    try:
        for q in body.questions:
            new_q = Question(
                id=str(uuid.uuid4()),
                question=q.question,
                options=q.options,
                entity_type=q.entity_type,
                category_id=q.category_id,
            )
            db.add(new_q)
            created.append({
                "id": new_q.id,
                "question": new_q.question,
                "options": new_q.options,
                "entity_type": new_q.entity_type,
                "category_id": new_q.category_id,
            })
        db.commit()
    except Exception as e:
        db.rollback()
        raise e

    return standard_response(201, f"{len(created)} question(s) created successfully", created)


# ── Category Endpoints ──

@question_router.get("/categories")
def get_categories(
        entity_type: Optional[EntityType] = Query(None, description="Filter by entity type"),
        db: Session = Depends(get_db)
):
    """
    Get all categories, optionally filtered by entity_type.
    """
    query = db.query(Category)
    if entity_type:
        query = query.filter(Category.entity_type == entity_type)
    results = query.order_by(Category.order, Category.name).all()

    data = [
        {
            "id": c.id,
            "name": c.name,
            "entity_type": c.entity_type,
            "order": float(c.order) if c.order is not None else None,
        }
        for c in results
    ]

    return standard_response(200, f"{len(data)} category(ies) fetched", data)


@question_router.post("/categories", dependencies=[Depends(require_roles("ADMIN"))])
def create_category(
        body: CategoryCreate,
        db: Session = Depends(get_db)
):
    """
    Create a new category.
    """
    # Check for duplicate name + entity_type
    existing = (
        db.query(Category)
        .filter(Category.name == body.name, Category.entity_type == body.entity_type)
        .first()
    )
    if existing:
        return standard_response(
            400,
            f"Category '{body.name}' already exists for entity_type '{body.entity_type}'",
            {"id": existing.id, "name": existing.name}
        )

    new_cat = Category(
        id=str(uuid.uuid4()),
        name=body.name,
        entity_type=body.entity_type,
        order=body.order,
    )
    db.add(new_cat)
    db.commit()
    db.refresh(new_cat)

    return standard_response(201, "Category created successfully", {
        "id": new_cat.id,
        "name": new_cat.name,
        "entity_type": new_cat.entity_type,
        "order": float(new_cat.order) if new_cat.order is not None else None,
    })


@question_router.put("/categories/{category_id}", dependencies=[Depends(require_roles("ADMIN"))])
def update_category(
        category_id: str,
        body: CategoryUpdate,
        db: Session = Depends(get_db)
):
    """
    Update an existing category's name or order.
    """
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        return standard_response(404, f"Category '{category_id}' not found", None)

    if body.name is not None:
        cat.name = body.name
    if body.order is not None:
        cat.order = body.order

    db.commit()
    db.refresh(cat)

    return standard_response(200, "Category updated successfully", {
        "id": cat.id,
        "name": cat.name,
        "entity_type": cat.entity_type,
        "order": float(cat.order) if cat.order is not None else None,
    })


@question_router.delete("/categories/{category_id}", dependencies=[Depends(require_roles("ADMIN"))])
def delete_category(
        category_id: str,
        db: Session = Depends(get_db)
):
    """
    Delete a category. Fails if it still has questions.
    """
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        return standard_response(404, f"Category '{category_id}' not found", None)

    question_count = db.query(Question).filter(Question.category_id == category_id).count()
    if question_count > 0:
        return standard_response(
            400,
            f"Cannot delete: category still has {question_count} question(s). Remove them first.",
            None
        )

    db.delete(cat)
    db.commit()

    return standard_response(200, "Category deleted successfully", {"id": category_id})
