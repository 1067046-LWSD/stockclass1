FROM python:3.11-slim
WORKDIR /app
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ .
EXPOSE 5001
CMD ["python", "app.py"]
