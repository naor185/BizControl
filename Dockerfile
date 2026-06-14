FROM python:3.10-slim

WORKDIR /app

# Install Hebrew-capable fonts (DejaVu) for PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000

CMD ["python", "start.py"]
