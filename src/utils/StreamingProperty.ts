/**
 * A reactive wrapper for a property that is populated asynchronously.
 * It allows consumers to subscribe to updates and get the latest value.
 */
export class StreamingProperty<T> {
    private _value: T;
    private readonly _subscribers: Set<(value: T) => void> = new Set();
    private _isFinalized = false;

    constructor(initialValue: T) {
        this._value = initialValue;
    }

    /** The current value of the property. */
    public get value(): T {
        return this._value;
    }

    /**
     * [Internal] Updates the property's value and notifies subscribers.
     * @internal
     */
    _update(newValue: T) {
        if (this._isFinalized) return;
        this._value = newValue;
        for (const callback of this._subscribers) {
            callback(this._value);
        }
    }

    /**
     * [Internal] Marks the property as complete.
     * @internal
     */
    _finalize() {
        this._isFinalized = true;
    }

    /**
     * Subscribes to changes for this property. The callback is immediately
     * invoked with the current value upon subscription.
     * @param callback The function to call with the new value.
     * @returns An unsubscribe function.
     */
    subscribe(callback: (value: T) => void): () => void {
        callback(this._value); // Immediately invoke with the current value
        this._subscribers.add(callback);
        return () => {
            this._subscribers.delete(callback);
        };
    }
}
