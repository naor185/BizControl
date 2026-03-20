import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.models.product import Product
from app.schemas.product import ProductCreate, ProductUpdate, ProductResponse
from app.schemas.product_sale import ProductSaleCreate, ProductSaleResponse
from app.models.product_sale import ProductSale

router = APIRouter(prefix="/products", tags=["Product Catalog"])


@router.post("/", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    product_in: ProductCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Create a new product in the studio catalog."""
    db_product = Product(
        **product_in.model_dump(),
        studio_id=ctx.studio_id
    )
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product


@router.get("/", response_model=List[ProductResponse])
def list_products(
    category: Optional[str] = Query(None),
    is_active: bool = Query(True),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """List all products in the studio, optionally filtered by category."""
    stmt = select(Product).where(
        and_(
            Product.studio_id == ctx.studio_id,
            Product.is_active == is_active
        )
    )
    if category:
        stmt = stmt.where(Product.category == category)
    
    return db.execute(stmt).scalars().all()


@router.get("/sales-history", response_model=List[dict])
def get_sales_history(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Get a list of all product sales in the studio."""
    from app.models.product_sale import ProductSale
    from app.models.product import Product
    from app.models.user import User

    stmt = select(
        ProductSale.id,
        ProductSale.quantity,
        ProductSale.unit_price_cents,
        ProductSale.total_price_cents,
        ProductSale.created_at,
        Product.name.label("product_name"),
        User.display_name.label("sold_by_name")
    ).join(
        Product, Product.id == ProductSale.product_id
    ).outerjoin(
        User, User.id == ProductSale.user_id
    ).where(
        ProductSale.studio_id == ctx.studio_id
    ).order_by(ProductSale.created_at.desc())
    
    rows = db.execute(stmt).all()
    return [dict(row._mapping) for row in rows]


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Get a specific product by ID."""
    product = db.execute(
        select(Product).where(
            and_(Product.id == product_id, Product.studio_id == ctx.studio_id)
        )
    ).scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: uuid.UUID,
    product_in: ProductUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Update a product's details."""
    product = db.execute(
        select(Product).where(
            and_(Product.id == product_id, Product.studio_id == ctx.studio_id)
        )
    ).scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    update_data = product_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(product, key, value)
    
    db.commit()
    db.refresh(product)
    return product


@router.patch("/{product_id}/stock", response_model=ProductResponse)
def update_product_stock(
    product_id: uuid.UUID,
    quantity: int = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Manually update a product's stock quantity."""
    product = db.execute(
        select(Product).where(
            and_(Product.id == product_id, Product.studio_id == ctx.studio_id)
        )
    ).scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    product.stock_quantity = quantity
    db.commit()
    db.refresh(product)
    return product


@router.post("/{product_id}/sell", response_model=ProductSaleResponse)
def record_sale(
    product_id: uuid.UUID,
    sale_in: ProductSaleCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Record a product sale, decrementing stock."""
    product = db.execute(
        select(Product).where(
            and_(Product.id == product_id, Product.studio_id == ctx.studio_id)
        )
    ).scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    if product.stock_quantity < sale_in.quantity:
        raise HTTPException(status_code=400, detail="Not enough stock")
    
    product.stock_quantity -= sale_in.quantity
    
    db_sale = ProductSale(
        **sale_in.model_dump(),
        product_id=product_id,
        studio_id=ctx.studio_id,
        user_id=ctx.user_id if not sale_in.user_id else sale_in.user_id
    )
    db.add(db_sale)
    db.commit()
    db.refresh(db_sale)
    
    # Return with joined data for response
    return db.execute(
        select(
            ProductSale.id,
            ProductSale.product_id,
            ProductSale.payment_id,
            ProductSale.user_id,
            ProductSale.quantity,
            ProductSale.unit_price_cents,
            ProductSale.total_price_cents,
            ProductSale.created_at,
            Product.name.label("product_name")
        ).join(Product, Product.id == ProductSale.product_id)
        .where(ProductSale.id == db_sale.id)
    ).first()
@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Soft delete or de-activate a product."""
    product = db.execute(
        select(Product).where(
            and_(Product.id == product_id, Product.studio_id == ctx.studio_id)
        )
    ).scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    # We'll do a hard delete for now as per simple CRUD, or soft delete by setting is_active=False
    db.delete(product)
    db.commit()
    return
